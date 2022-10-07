//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import {
  AppPurpose,
  IGitHubAppConfiguration,
  IGitHubAppsOptions,
  GitHubAppAuthenticationType,
  AllAvailableAppPurposes,
  AppPurposeToConfigurationName,
} from '.';
import { GitHubAppTokens } from './appTokens';
import { IAuthorizationHeaderValue, NoCacheNoBackground } from '../interfaces';
import { OrganizationSetting } from '../entities/organizationSettings/organizationSetting';
import { readFileToText } from '../utils';
import { Operations, OperationsCore, Organization } from '../business';
import { CreateError } from '../transitional';

const fallbackPurposePriorities = [
  AppPurpose.Data,
  AppPurpose.CustomerFacing,
  AppPurpose.Operations,
  AppPurpose.BackgroundJobs,
];

const fallbackBackgroundJobPriorities = [
  AppPurpose.BackgroundJobs,
  AppPurpose.Data,
  AppPurpose.CustomerFacing,
  AppPurpose.Operations,
];

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
  purpose: AppPurpose;
  installationId: number;
}

export class GitHubTokenManager {
  #options: IGitHubAppsOptions;
  private static _managersForOperations: Map<OperationsCore, GitHubTokenManager> = new Map();
  private static _forceBackgroundTokens: boolean;
  // private _appConfiguration = new Map<AppPurpose, IGitHubAppConfiguration>();
  private _apps = new Map<AppPurpose, GitHubAppTokens>();
  private _appsById = new Map<number, GitHubAppTokens>();
  private _appIdToPurpose = new Map<number, AppPurpose>();
  private _appSlugs = new Map<number, string>();
  private _forceInstanceTokensToPurpose: AppPurpose;
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

  forceInstanceTokensToPurpose(purpose: AppPurpose) {
    this._forceInstanceTokensToPurpose = purpose;
  }

  allowReadOnlyFallbackForUninstalledOrganizations() {
    this._allowReadOnlyFallbackToOtherInstallations = true;
  }

  async initialize() {
    for (let appPurpose of AllAvailableAppPurposes) {
      const configurationValue = this.#options.configurations.get(appPurpose);
      if (configurationValue) {
        await this.initializeApp(appPurpose, configurationValue);
      }
    }
  }

  organizationSupportsAnyPurpose(organizationName: string, organizationSettings?: OrganizationSetting) {
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

  async getOrganizationAuthorizationHeader(
    organizationName: string,
    preferredPurpose: AppPurpose,
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
        `GitHubTokenManager: organization ${organizationName} does not support the GitHub App model`
      );
    }
    if (
      appAuthenticationType === GitHubAppAuthenticationType.BestAvailable &&
      installationIdPair.purpose !== preferredPurpose
    ) {
      // console.log(`preferred GitHub App type ${preferredPurpose} not configured for organization ${organizationName}, falling back to ${installationIdPair.purpose}`);
    }
    const app = this._apps.get(installationIdPair.purpose);
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

  async getRateLimitInformation(purpose: AppPurpose, organization: Organization) {
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
    preferredPurpose: AppPurpose,
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
    let order =
      GitHubTokenManager._forceBackgroundTokens === true
        ? fallbackBackgroundJobPriorities
        : [preferredPurpose, ...fallbackPurposePriorities];
    if (appAuthenticationType === GitHubAppAuthenticationType.ForceSpecificInstallation) {
      order = [preferredPurpose];
    }
    for (const purpose of order) {
      if (organizationSettings?.installations) {
        for (const { appId, installationId } of organizationSettings.installations) {
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

  private async initializeApp(purpose: AppPurpose, appConfig: IGitHubAppConfiguration) {
    if (!appConfig || !appConfig.appId) {
      return;
    }
    const appId = typeof appConfig.appId === 'number' ? appConfig.appId : parseInt(appConfig.appId, 10);
    if (this._appsById.has(appId)) {
      return;
    }
    let key = appConfig.appKey;
    let fromLocalFile = false;
    if (appConfig.appKeyFile) {
      key = await readFileToText(appConfig.appKeyFile);
      fromLocalFile = true;
    }
    if (!key) {
      throw new Error(`appKey or appKeyFile required for ${purpose} GitHub App configuration`);
    }
    const friendlyName = appConfig.description || 'Unknown';
    const baseUrl = appConfig.baseUrl;
    const app = fromLocalFile
      ? GitHubAppTokens.CreateFromString(purpose, friendlyName, appId, key, baseUrl)
      : GitHubAppTokens.CreateFromBase64EncodedFileString(purpose, friendlyName, appId, key, baseUrl);
    this._apps.set(purpose, app);
    this._appsById.set(appId, app);
    this._appSlugs.set(appId, appConfig.slug);
    this._appIdToPurpose.set(appId, purpose);
  }
}
