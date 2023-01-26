//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import {
  AppPurpose,
  IGitHubAppConfiguration,
  IGitHubAppsOptions,
  GitHubAppAuthenticationType,
  ICustomAppPurpose,
  GitHubAppPurposes,
  AppPurposeTypes,
} from '.';
import { GitHubAppTokens } from './appTokens';
import { IAuthorizationHeaderValue, NoCacheNoBackground } from '../interfaces';
import { OrganizationSetting } from '../entities/organizationSettings/organizationSetting';
import { readFileToText } from '../utils';
import { Operations, OperationsCore, Organization } from '../business';
import { CreateError } from '../transitional';

export interface IGitHubRateLimit {
  limit: number;
  remaining: number;
  reset: number;
  used: number;
}

// Installation redirect format:
// /setup/app/41051?installation_id=1914154&setup_action=install

// 1: check if the app id is known
// 2: request installation info as the app
// 3: configure org setting/s, or add the org!

interface InstallationIdPurposePair {
  purpose: AppPurposeTypes;
  installationId: number;
}

export class GitHubTokenManager {
  #options: IGitHubAppsOptions;
  private static _managersForOperations: Map<OperationsCore, GitHubTokenManager> = new Map();
  private static _forceBackgroundTokens: boolean;
  // private _appConfiguration = new Map<AppPurpose, IGitHubAppConfiguration>();
  private _apps = new Map<AppPurposeTypes, GitHubAppTokens>();
  private _appsById = new Map<number, GitHubAppTokens>();
  private _appIdToPurpose = new Map<number, AppPurposeTypes>();
  private _appSlugs = new Map<number, string>();
  private _forceInstanceTokensToPurpose: AppPurposeTypes;
  private _allowReadOnlyFallbackToOtherInstallations: boolean;

  static RegisterManagerForOperations(operations: OperationsCore, manager: GitHubTokenManager) {
    GitHubTokenManager._managersForOperations.set(operations, manager);
  }

  static TryGetTokenManagerForOperations(operations: OperationsCore) {
    return GitHubTokenManager._managersForOperations.get(operations);
  }

  constructor(options: IGitHubAppsOptions) {
    if (!options) {
      throw new Error('options required');
    }
    this.#options = options;
    GitHubTokenManager._forceBackgroundTokens =
      options.app.isBackgroundJob && !options.app.enableAllGitHubApps;
  }

  private getFallbackList(input: AppPurposeTypes[]) {
    const clone = this.isForcingBackgroundJobType()
      ? [AppPurpose.BackgroundJobs, ...[...input].filter((p) => p !== AppPurpose.BackgroundJobs)]
      : [...input];
    return clone;
  }

  private isForcingBackgroundJobType() {
    return GitHubTokenManager._forceBackgroundTokens === true;
  }

  forceInstanceTokensToPurpose(purpose: AppPurposeTypes) {
    this._forceInstanceTokensToPurpose = purpose;
  }

  allowReadOnlyFallbackForUninstalledOrganizations() {
    this._allowReadOnlyFallbackToOtherInstallations = true;
  }

  async initialize() {
    for (const appPurpose of GitHubAppPurposes.AllAvailableAppPurposes) {
      const asCustom = appPurpose as ICustomAppPurpose;
      if (asCustom?.isCustomAppPurpose === true) {
        // skip
      } else {
        const configurationValue = this.#options.configurations.get(appPurpose);
        if (configurationValue) {
          await this.initializeApp(appPurpose, configurationValue);
        }
      }
    }
  }

  organizationSupportsAnyPurpose(organizationName: string, organizationSettings?: OrganizationSetting) {
    const fallbackPurposePriorities = this.getFallbackList(GitHubAppPurposes.AllAvailableAppPurposes);
    return !!this.getPrioritizedOrganizationInstallationId(
      fallbackPurposePriorities[0],
      organizationName,
      organizationSettings,
      GitHubAppAuthenticationType.BestAvailable
    );
  }

  getAppById(id: number): GitHubAppTokens {
    return this._appsById.get(id);
  }

  getAppIds(): number[] {
    return Array.from(this._appsById.keys());
  }

  getSlugById(id: number): string {
    return this._appSlugs.get(id);
  }

  private getPurposeDisplayId(purpose: AppPurposeTypes) {
    const asCustom = purpose as ICustomAppPurpose;
    if (asCustom?.isCustomAppPurpose === true) {
      return asCustom.id;
    }
    return purpose;
  }

  private getCustomPurpose(purpose: AppPurposeTypes): ICustomAppPurpose {
    const asCustom = purpose as ICustomAppPurpose;
    if (asCustom?.isCustomAppPurpose === true) {
      return asCustom;
    }
    return null;
  }

  async getOrganizationAuthorizationHeader(
    organizationName: string,
    preferredPurpose: AppPurposeTypes,
    organizationSettings: OrganizationSetting,
    appAuthenticationType: GitHubAppAuthenticationType
  ): Promise<IAuthorizationHeaderValue> {
    const installationIdPair = this.getPrioritizedOrganizationInstallationId(
      preferredPurpose,
      organizationName,
      organizationSettings,
      appAuthenticationType
    );
    if (!installationIdPair) {
      throw new Error(
        `GitHubTokenManager: organization ${organizationName} does not have a configured GitHub App installation, or, the installation information is not in this environment.`
      );
    }
    if (
      appAuthenticationType === GitHubAppAuthenticationType.BestAvailable &&
      installationIdPair.purpose !== preferredPurpose
    ) {
      // console.log(`preferred GitHub App type ${preferredPurpose} not configured for organization ${organizationName}, falling back to ${installationIdPair.purpose}`);
    }
    const asCustomPurpose = this.getCustomPurpose(installationIdPair.purpose);
    let app = this._apps.get(installationIdPair.purpose);
    if (!app && asCustomPurpose) {
      app = await this.initializeApp(asCustomPurpose, asCustomPurpose.configuration);
    }
    if (!app) {
      throw new Error(
        `No GitHub App is configured for the purpose ${this.getPurposeDisplayId(installationIdPair.purpose)}`
      );
    }
    return app.getInstallationToken(installationIdPair.installationId, organizationName);
  }

  async getInstallationAuthorizationHeader(
    appId: number,
    installationId: number,
    organizationName: string
  ): Promise<IAuthorizationHeaderValue> {
    const app = this._appsById.get(appId);
    if (!app) {
      throw new Error(`App ID=${appId} is not configured in this application instance`);
    }
    return app.getInstallationToken(installationId, organizationName);
  }

  getAppForPurpose(purpose: AppPurpose) {
    return this._apps.get(purpose);
  }

  getInstallationIdForOrganization(purpose: AppPurpose, organization: Organization) {
    if (!organization.hasDynamicSettings) {
      throw CreateError.InvalidParameters(
        `Organization ${organization.name} does not have dynamic settings, which is currently required for this capability`
      );
    }
    const settings = organization.getDynamicSettings();
    if (settings?.installations) {
      for (const { appId, installationId } of settings.installations) {
        const purposeForApp = this._appIdToPurpose.get(appId);
        if (this._appsById.has(appId) && purposeForApp && purposeForApp === purpose) {
          return installationId;
        }
      }
    }
  }

  async getRateLimitInformation(purpose: AppPurposeTypes, organization: Organization) {
    if (!organization.hasDynamicSettings) {
      throw CreateError.InvalidParameters(
        `Organization ${organization.name} does not have dynamic settings, which is currently required for this capability`
      );
    }
    const settings = organization.getDynamicSettings();
    if (settings?.installations) {
      for (const { appId, installationId } of settings.installations) {
        const purposeForApp = this._appIdToPurpose.get(appId);
        if (this._appsById.has(appId) && purposeForApp && purposeForApp === purpose) {
          try {
            const header = await this.getInstallationAuthorizationHeader(
              appId,
              installationId,
              organization.name
            );
            const value = await (organization.operations as Operations).github.post(
              header.value,
              'rateLimit.get',
              NoCacheNoBackground
            );
            if (value?.rate) {
              return value.rate as IGitHubRateLimit;
            }
            console.warn(value);
            throw CreateError.InvalidParameters('No rate limit information returned');
          } catch (error) {
            throw error;
          }
        }
      }
    }
  }

  private getPrioritizedOrganizationInstallationId(
    preferredPurpose: AppPurposeTypes,
    organizationName: string,
    organizationSettings: OrganizationSetting,
    appAuthenticationType: GitHubAppAuthenticationType
  ): InstallationIdPurposePair {
    if (this._forceInstanceTokensToPurpose) {
      if (this._forceInstanceTokensToPurpose !== preferredPurpose) {
        // console.log(`This instance of TokenManager forced the purpose to ${this._forceInstanceTokensToPurpose} from ${preferredPurpose}`);
      }
      preferredPurpose = this._forceInstanceTokensToPurpose;
    }
    if (!organizationSettings) {
      return null;
    }
    const fallbackPurposePriorities = this.getFallbackList(GitHubAppPurposes.AllAvailableAppPurposes);
    let order =
      this.isForcingBackgroundJobType() === true
        ? fallbackPurposePriorities
        : [preferredPurpose, ...fallbackPurposePriorities];
    if (appAuthenticationType === GitHubAppAuthenticationType.ForceSpecificInstallation) {
      order = [preferredPurpose];
    }
    for (const purpose of order) {
      let customAppPurpose = purpose as ICustomAppPurpose;
      if (!(customAppPurpose?.isCustomAppPurpose === true)) {
        customAppPurpose = null;
      }
      if (organizationSettings?.installations) {
        for (const { appId, installationId, appPurposeId } of organizationSettings.installations) {
          if (appPurposeId && customAppPurpose?.id === appPurposeId) {
            return { installationId, purpose: customAppPurpose };
          }
          const purposeForApp = this._appIdToPurpose.get(appId);
          if (this._appsById.has(appId) && purposeForApp && purposeForApp === purpose) {
            return { installationId, purpose };
          }
        }
      }
    }
    if (this._allowReadOnlyFallbackToOtherInstallations && organizationSettings?.installations?.length > 0) {
      return {
        installationId: organizationSettings.installations[0].installationId,
        purpose: preferredPurpose,
      };
    }
    return null;
  }

  private async initializeApp(purpose: AppPurposeTypes, appConfig: IGitHubAppConfiguration) {
    const customPurpose = purpose as ICustomAppPurpose;
    if (!appConfig || !appConfig.appId) {
      return;
    }
    const appId = typeof appConfig.appId === 'number' ? appConfig.appId : parseInt(appConfig.appId, 10);
    if (this._appsById.has(appId)) {
      return;
    }
    let key = appConfig.appKey;
    let skipDecodingBase64 = false;
    if (appConfig.appKeyFile) {
      key = await readFileToText(appConfig.appKeyFile);
      skipDecodingBase64 = true;
    }
    if (!key) {
      throw new Error(`appKey or appKeyFile required for ${purpose} GitHub App configuration`);
    }
    if (key?.includes('-----BEGIN RSA')) {
      // Not base64-encoded, use the CreateFromString method.
      skipDecodingBase64 = true;
    }
    const friendlyName = customPurpose?.name || appConfig.description || 'Unknown';
    const baseUrl = appConfig.baseUrl;
    const app = skipDecodingBase64
      ? GitHubAppTokens.CreateFromString(purpose, friendlyName, appId, key, baseUrl)
      : GitHubAppTokens.CreateFromBase64EncodedFileString(purpose, friendlyName, appId, key, baseUrl);
    this._apps.set(purpose, app);
    this._appsById.set(appId, app);
    this._appSlugs.set(appId, appConfig.slug);
    this._appIdToPurpose.set(appId, purpose);
    if (customPurpose?.isCustomAppPurpose === true) {
      console.log(
        `Custom GitHub App, ${customPurpose.name} (id=${customPurpose.id}, appId=${appId}, slug=${appConfig.slug}) initialized`
      );
    }
    return app;
  }
}
