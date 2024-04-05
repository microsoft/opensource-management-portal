//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import Debug from 'debug';
const debug = Debug('github:tokens');

import {
  AppPurpose,
  IGitHubAppConfiguration,
  IGitHubAppsOptions,
  GitHubAppAuthenticationType,
  ICustomAppPurpose,
  GitHubAppPurposes,
  AppPurposeTypes,
  getAppPurposeId,
} from './appPurposes';
import { GitHubAppTokens } from './appTokens';
import { AuthorizationHeaderValue, GetAuthorizationHeader, NoCacheNoBackground } from '../../interfaces';
import { OrganizationSetting } from '../../business/entities/organizationSettings/organizationSetting';
import { readFileToText } from '../utils';
import { Operations, OperationsCore, Organization } from '../../business';
import { CreateError } from '../transitional';
import { shuffle } from 'lodash';

export type GitHubRateLimit = {
  limit: number;
  remaining: number;
  reset: number;
  used: number;
};

// Installation redirect format:
// /setup/app/APP_ID?installation_id=INSTALLATION_ID&setup_action=install

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
  private _apps = new Map<AppPurposeTypes, GitHubAppTokens>();
  private _appsById = new Map<number, GitHubAppTokens>();
  private _appIdToPurpose = new Map<number, AppPurposeTypes>();
  private _appSlugs = new Map<number, string>();
  private _forceInstanceTokensToPurpose: AppPurposeTypes;
  private _allowReadOnlyFallbackToOtherInstallations: boolean;

  private static RegisterManagerForOperations(operations: OperationsCore, manager: GitHubTokenManager) {
    GitHubTokenManager._managersForOperations.set(operations, manager);
  }

  static TryGetTokenManagerForOperations(operations: OperationsCore) {
    return GitHubTokenManager._managersForOperations.get(operations);
  }

  constructor(options: IGitHubAppsOptions) {
    if (!options) {
      throw new Error('options required');
    }
    const executionEnvironment = options.executionEnvironment;
    this.#options = options;
    GitHubTokenManager._forceBackgroundTokens =
      executionEnvironment.isJob && !executionEnvironment.enableAllGitHubApps;
    GitHubTokenManager.RegisterManagerForOperations(options.operations, this);
  }

  private operations() {
    return this.#options.operations as Operations;
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
    debug('Initializing GitHubTokenManager and all available app purposes');
    for (const appPurpose of GitHubAppPurposes.AllAvailableAppPurposes) {
      const asCustom = appPurpose as ICustomAppPurpose;
      if (asCustom?.isCustomAppPurpose === true) {
        if (asCustom?.getApplicationConfigurationForInitialization) {
          debug(`Pre-initializing custom app purpose ${asCustom.id}`);
          const configuration = asCustom.getApplicationConfigurationForInitialization();
          await this.initializeApp(asCustom, configuration);
          debug(`Initialized custom app purpose ${asCustom.id}`);
        } else {
          debug(`Skipping initialization of custom app purpose ${asCustom.id}`);
        }
      } else {
        const configurationValue = this.#options.configurations.get(appPurpose);
        if (configurationValue) {
          debug(`Initializing app purpose ${appPurpose}`);
          await this.initializeApp(appPurpose, configurationValue);
        } else {
          debug(`No configuration found for app purpose ${appPurpose}`);
        }
      }
    }
  }

  organizationSupportsAnyPurpose(organizationName: string, organizationSettings?: OrganizationSetting) {
    const fallbackPurposePriorities = this.getFallbackList(GitHubAppPurposes.AllAvailableAppPurposes);
    const value = !!this.getPrioritizedOrganizationInstallationId(
      fallbackPurposePriorities[0],
      organizationName,
      organizationSettings,
      GitHubAppAuthenticationType.BestAvailable
    );
    debug(
      `organizationSupportsAnyPurpose(${organizationName}${
        organizationSettings ? ' (with settings specific)' : ''
      }) => ${value}`
    );
    return value;
  }

  getAppById(id: number): GitHubAppTokens {
    debug(`getAppById(${id})`);
    return this._appsById.get(id);
  }

  getAppIds(): number[] {
    debug(`getAppIds()`);
    return Array.from(this._appsById.keys());
  }

  getSlugById(id: number): string {
    debug(`getSlugById(${id})`);
    return this._appSlugs.get(id);
  }

  private getPurposeDisplayId(purpose: AppPurposeTypes) {
    // is this identical to the method getAppPurposeId?

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

  async ensureConfigurationAppInitialized(
    customPurpose: AppPurposeTypes,
    customPurposeConfiguration: IGitHubAppConfiguration
  ): Promise<GitHubAppTokens> {
    const appId = customPurposeConfiguration.appId;
    const asCustomPurpose = this.getCustomPurpose(customPurpose);
    if (!asCustomPurpose?.isCustomAppPurpose) {
      throw CreateError.InvalidParameters(`The purpose ${customPurpose} is not a custom app purpose`);
    }
    let app = this._appsById.get(appId);
    if (!app) {
      debug(`initializing app for custom purpose ${asCustomPurpose.id} with custom configuration`);
      app = await this.initializeApp(asCustomPurpose, customPurposeConfiguration);
    }
    if (!app) {
      throw CreateError.InvalidParameters(
        `Error initializing purpose ${this.getPurposeDisplayId(customPurpose)}`
      );
    }
    return app;
  }

  async getOrganizationAuthorizationHeader(
    organizationName: string,
    preferredPurpose: AppPurposeTypes,
    organizationSettings: OrganizationSetting,
    appAuthenticationType: GitHubAppAuthenticationType
  ): Promise<AuthorizationHeaderValue> {
    debug(
      `getOrganizationAuthorizationHeader(${organizationName}, ${this.getPurposeDisplayId(
        preferredPurpose
      )}, ${appAuthenticationType})`
    );
    const installationIdPair = this.getPrioritizedOrganizationInstallationId(
      preferredPurpose,
      organizationName,
      organizationSettings,
      appAuthenticationType
    );
    if (!installationIdPair) {
      throw CreateError.InvalidParameters(
        `GitHubTokenManager: organization ${organizationName} does not have a configured GitHub App installation, or, the installation information is not in this environment. The API preferred purpose was ${getAppPurposeId(
          preferredPurpose
        )} with the selection type ${appAuthenticationType}.`
      );
    }
    if (
      appAuthenticationType === GitHubAppAuthenticationType.BestAvailable &&
      installationIdPair.purpose !== preferredPurpose
    ) {
      debug(
        `preferred GitHub App type ${preferredPurpose} not configured for organization ${organizationName}, falling back to ${installationIdPair.purpose}`
      );
    }
    const asCustomPurpose = this.getCustomPurpose(installationIdPair.purpose);
    const asStandardPurpose =
      !asCustomPurpose?.getForOrganizationName && (installationIdPair.purpose as AppPurpose);
    let app: GitHubAppTokens = null;
    let customPurposeConfiguration: IGitHubAppConfiguration = null;
    if (asCustomPurpose?.getForOrganizationName) {
      customPurposeConfiguration = asCustomPurpose?.getForOrganizationName(organizationName);
      if (customPurposeConfiguration?.appId) {
        debug(
          `purpose-specific configuration for ${organizationName} retrieved; appId=${customPurposeConfiguration.appId}`
        );
        const appId =
          typeof customPurposeConfiguration.appId === 'number'
            ? customPurposeConfiguration.appId
            : parseInt(customPurposeConfiguration.appId, 10);
        app = this._appsById.get(appId);
      } else {
        debug(`purpose-specific configuration for ${organizationName} not available}`);
      }
      debug(`app retrieved: ${app ? 'yes' : 'no'}`);
    }
    if (!app) {
      app = this._apps.get(asStandardPurpose);
      debug(
        `app retrieved with standard purpose ${this.getPurposeDisplayId(asStandardPurpose)}: ${
          app ? 'yes' : 'no'
        }`
      );
    }
    if (!app && customPurposeConfiguration) {
      debug(`initializing app for custom purpose ${asCustomPurpose.id} with custom configuration`);
      app = await this.initializeApp(asCustomPurpose, customPurposeConfiguration);
    }
    if (!app) {
      throw new Error(
        `No GitHub App is configured for the purpose ${this.getPurposeDisplayId(installationIdPair.purpose)}`
      );
    }
    debug(
      `getting installation token for installation ID ${installationIdPair.installationId} and organization ${organizationName}`
    );
    const value = await app.getInstallationToken(installationIdPair.installationId, organizationName);
    debug(
      `returned installation ID pair: installationId=${value?.installationId}, source=${value?.source}, purpose=${this.getPurposeDisplayId(
        value?.purpose
      )}`
    );
    return value;
  }

  getInstallationAuthorizationHeader(
    appId: number,
    installationId: number,
    organizationName: string
  ): Promise<AuthorizationHeaderValue> {
    const app = this._appsById.get(appId);
    if (!app) {
      throw new Error(`App ID=${appId} is not configured in this application instance`);
    }
    return app.getInstallationToken(installationId, organizationName);
  }

  getAppForPurpose(purpose: AppPurposeTypes, organizationName?: string) {
    const asCustomPurpose = this.getCustomPurpose(purpose);
    if (asCustomPurpose?.getForOrganizationName) {
      const configForOrganization = asCustomPurpose.getForOrganizationName(organizationName);
      const appId = configForOrganization.appId;
      if (appId) {
        return this._appsById.get(appId);
      }
    } else if (asCustomPurpose?.getApplicationConfigurationForInitialization) {
      const config = asCustomPurpose.getApplicationConfigurationForInitialization();
      const appId = config.appId;
      if (appId) {
        return this._appsById.get(appId);
      }
    }
    return this._apps.get(purpose);
  }

  getAnyConfiguredInstallationIdForAppId(operations: Operations, appId: number) {
    const orgs = operations.getOrganizations();
    for (const org of orgs) {
      const settings = org.getDynamicSettings();
      if (settings?.installations) {
        for (const { appId: appConfiguredId, installationId } of settings.installations) {
          if (appConfiguredId === appId) {
            return { installationId, organizationName: org.name };
          }
        }
      }
    }
  }

  getAnyConfiguredInstallationIdForAnyApp(operations: Operations) {
    const orgs = shuffle(operations.getOrganizations());
    for (const org of orgs) {
      const settings = org.getDynamicSettings();
      if (settings?.installations) {
        const installs = shuffle(settings.installations);
        const configuredInstalls = installs.filter((i) => this._appsById.has(i.appId));
        for (const { installationId, appId } of configuredInstalls) {
          return { installationId, organizationName: org.name, appId };
        }
      }
    }
  }

  getInstallationIdForOrganization(purpose: AppPurposeTypes, organization: Organization) {
    const settings = organization.getDynamicSettings();
    if (settings?.installations) {
      for (const { appId, installationId } of settings.installations) {
        const purposeForApp = this._appIdToPurpose.get(appId);
        if (this._appsById.has(appId) && purposeForApp && purposeForApp === purpose) {
          return installationId;
        }
      }
    }
    const asCustomPurpose = this.getCustomPurpose(purpose);
    if (asCustomPurpose?.getForOrganizationName) {
      const configForOrganization = asCustomPurpose.getForOrganizationName(organization.name);
      if (configForOrganization.slug) {
        throw CreateError.NotImplemented(
          `While a custom purpose is configured for the "${organization.name}" with the app ${configForOrganization.slug}, the installation ID is not yet available with this call. This is a known limitation.`
        );
      }
      throw CreateError.NotImplemented(
        `This custom purpose is not configured for the "${organization.name}" org with the app ${configForOrganization.slug}, the installation ID is not yet available with this call. This is a known limitation.`
      );
    }
    if (!organization.hasDynamicSettings) {
      throw CreateError.InvalidParameters(
        `Organization ${organization.name} does not have dynamic settings or purpose-directed configuration`
      );
    }
  }

  getAuthorizationHeaderForAnyApp(): Promise<AuthorizationHeaderValue> {
    const anyConfigured = this.getAnyConfiguredInstallationIdForAnyApp(this.operations());
    if (anyConfigured) {
      return this.getInstallationAuthorizationHeader(
        anyConfigured.appId,
        anyConfigured.installationId,
        anyConfigured.organizationName
      );
    }
    throw CreateError.InvalidParameters('No configured applications available.');
  }

  async getAppInformation(purpose: AppPurposeTypes, organizationName?: string) {
    const appTokens = this.getAppForPurpose(purpose, organizationName);
    if (!appTokens) {
      throw CreateError.InvalidParameters(`No app configured yet for purpose ${purpose}`);
    }
    const slug = appTokens.slug;
    if (!slug) {
      throw CreateError.InvalidParameters(`No slug configured for purpose ${purpose}`);
    }
    return this.getAppInformationBySlug(this.operations(), slug);
  }

  async getAppInformationBySlug(operations: Operations, slug: string) {
    let appId: number = null;
    for (const entry of this._appSlugs.entries()) {
      if (entry[1] === slug) {
        appId = entry[0];
        break;
      }
    }
    let authorizationHeader: GetAuthorizationHeader = null;
    // Have the app call itself via the slug-based API (works if it's a private single-org app)
    if (appId) {
      const anyConfiguredForApp = this.getAnyConfiguredInstallationIdForAppId(operations, appId);
      if (anyConfiguredForApp) {
        authorizationHeader = this.getInstallationAuthorizationHeader.bind(
          this,
          appId,
          anyConfiguredForApp.installationId,
          anyConfiguredForApp.organizationName
        );
      }
    }
    // Call using any configured app
    if (!authorizationHeader) {
      const anyConfigured = this.getAnyConfiguredInstallationIdForAnyApp(operations);
      if (anyConfigured) {
        authorizationHeader = this.getInstallationAuthorizationHeader.bind(
          this,
          anyConfigured.appId,
          anyConfigured.installationId,
          anyConfigured.organizationName
        );
      }
    }
    // Fallback to a static token
    if (!authorizationHeader) {
      authorizationHeader = operations.getPublicReadOnlyStaticToken.bind(operations);
    }
    const value = await operations.github.post(authorizationHeader, 'apps.getBySlug', {
      app_slug: slug,
    });
    return value;
  }

  async getRateLimitInformation(purpose: AppPurposeTypes, organization: Organization) {
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
              return value.rate as GitHubRateLimit;
            }
            console.warn(value);
            throw CreateError.InvalidParameters('No rate limit information returned');
          } catch (error) {
            throw error;
          }
        }
      }
    }
    // CONSIDER: custom app purposes could expose the installation ID here
    if (!organization.hasDynamicSettings) {
      throw CreateError.InvalidParameters(
        `Organization ${organization.name} does not have dynamic settings, which is currently required for this capability`
      );
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
    const allPurposes = GitHubAppPurposes.AllAvailableAppPurposes;
    const fallbackPurposePriorities = this.getFallbackList(allPurposes);
    const customPurposes = allPurposes.filter((p) => (p as ICustomAppPurpose).isCustomAppPurpose === true);
    const matchingCustomPurposes =
      (preferredPurpose as ICustomAppPurpose)?.isCustomAppPurpose === true
        ? customPurposes.filter(
            (cp) => (cp as ICustomAppPurpose).id === (preferredPurpose as ICustomAppPurpose).id
          )
        : customPurposes;
    let order =
      this.isForcingBackgroundJobType() === true
        ? fallbackPurposePriorities
        : [preferredPurpose, ...fallbackPurposePriorities];
    if (appAuthenticationType === GitHubAppAuthenticationType.ForceSpecificInstallation) {
      order = [preferredPurpose, ...matchingCustomPurposes];
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
    const purposeAppId = getAppPurposeId(purpose);
    if (!appConfig || !appConfig.appId) {
      debug(`No app configuration for ${purposeAppId} GitHub App`);
      return;
    }
    const appId = typeof appConfig.appId === 'number' ? appConfig.appId : parseInt(appConfig.appId, 10);
    if (this._appsById.has(appId)) {
      return this._appsById.get(appId);
    }
    debug(`Initializing ${purposeAppId} GitHub App with ID=${appId}`);
    let key = appConfig.appKey;
    let skipDecodingBase64 = false;
    if (appConfig.appKeyFile) {
      key = await readFileToText(appConfig.appKeyFile);
      skipDecodingBase64 = true;
    }
    if (!key) {
      throw new Error(`appKey or appKeyFile required for ${purposeAppId} GitHub App configuration`);
    }
    if (key?.includes('-----BEGIN RSA')) {
      // Not base64-encoded, use the CreateFromString method.
      skipDecodingBase64 = true;
    }
    const slug = appConfig.slug;
    const friendlyName = customPurpose?.name || appConfig.description || 'Unknown';
    const baseUrl = appConfig.baseUrl;
    const app = skipDecodingBase64
      ? GitHubAppTokens.CreateFromString(purpose, slug, friendlyName, appId, key, baseUrl)
      : GitHubAppTokens.CreateFromBase64EncodedFileString(purpose, slug, friendlyName, appId, key, baseUrl);
    const hasCustomConfigurationByOrganization = customPurpose?.getForOrganizationName;
    const standardPurpose = purpose as AppPurpose;
    if (!hasCustomConfigurationByOrganization) {
      this._apps.set(standardPurpose, app);
    }
    this._appsById.set(appId, app);
    this._appSlugs.set(appId, appConfig.slug);
    this._appIdToPurpose.set(appId, purpose);
    if (customPurpose?.isCustomAppPurpose === true) {
      console.log(
        `Custom GitHub App, ${customPurpose.name} (id=${customPurpose.id}, appId=${appId}, slug=${
          appConfig.slug
        }${hasCustomConfigurationByOrganization ? ', org-specific-variance' : ''}) initialized`
      );
    }
    return app;
  }
}
