//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import lodash from 'lodash';
const { shuffle } = lodash;
import { throat } from '../../vendor/throat/index.js';

import type { TelemetryClient } from 'applicationinsights';

import jsonImportAppPermissions from '@octokit/app-permissions';

import Debug from 'debug';
const debug = Debug('github:tokens');

import {
  AppPurpose,
  GitHubAppConfiguration,
  GitHubAppsOptions,
  GitHubAppAuthenticationType,
  ICustomAppPurpose,
  GitHubAppPurposes,
  AppPurposeTypes,
  getAppPurposeId,
} from './appPurposes.js';
import { GitHubAppTokens } from './appTokens.js';
import {
  AuthorizationHeaderValue,
  GetAuthorizationHeader,
  NoCacheNoBackground,
} from '../../interfaces/index.js';
import {
  BasicGitHubAppInstallation,
  OrganizationSetting,
} from '../../business/entities/organizationSettings/organizationSetting.js';
import { readFileToText } from '../utils.js';
import { Operations, Organization } from '../../business/index.js';
import { CreateError, ErrorHelper } from '../transitional.js';
import { AppInstallation } from './appInstallation.js';
import {
  GitHubAppInformation,
  GitHubAuthenticationRequirement,
  GitHubPathPermissionDefinitionsByMethod,
} from './types.js';

const githubAppPermissions = jsonImportAppPermissions['api.github.com'];
if (!githubAppPermissions) {
  throw new Error('No GitHub app permissions data found');
}

const parallelInstallationLearning = 3;

export type GitHubRateLimit = {
  limit: number;
  remaining: number;
  reset: number;
  used: number;
};

export type GitHubRateLimits = {
  actions_runner_registration: GitHubRateLimit;
  audit_log: GitHubRateLimit;
  code_scanning_upload: GitHubRateLimit;
  code_search: GitHubRateLimit;
  core: GitHubRateLimit;
  dependency_snapshots: GitHubRateLimit;
  graphql: GitHubRateLimit;
  integration_manifest: GitHubRateLimit;
  scim: GitHubRateLimit;
  search: GitHubRateLimit;
  source_import: GitHubRateLimit;
};

type GitHubRateLimitResponse = {
  resources: GitHubRateLimits;
  rate: GitHubRateLimit; // being deprecated
};

function parseMethodFromUrl(url: string) {
  const parts = url.split(' ');
  return { method: parts[0], url: parts[1] };
}

const knownParameterTranslations = {
  ':enterprise': '{enterprise}',
  ':installation_id': '{installation_id}',
  ':installationId': '{installation_id}',
  ':orgName': '{org}',
  ':org_id': '{org}',
  ':team_slug': '{team_slug}',
  ':team_id': '{team_id}',
  ':team': '{team}',
  ':username': '{login}',
  ':id': '', // /repositories/:id
  ':owner': '{owner}',
  ':repo': '{repo}',
  ':org': '{org}',
};

function removeOctokitParametersFromUrl(url: string) {
  // go through known translations
  for (const [translation, replacement] of Object.entries(knownParameterTranslations)) {
    url = url.replaceAll(translation, replacement);
  }

  if (url.includes(':')) {
    console.warn(`Unknown parameter in URL: ${url}`);
  }

  // a parameter is something like :repoId
  // remove anything like that
  return url.replace(/:[^/]+/g, '');
}

function cleanupOctokitLookupUrl(url: string) {
  // special cases
  if (url.endsWith('/readme')) {
    return url + '(?:/(.*))?';
  }
  if (url.endsWith('/')) {
    url = url.substring(0, url.length - 1);
  }
  const permissionsExist = githubAppPermissions.paths[url];
  if (!permissionsExist) {
    // try removing the last segment
    const parts = url.split('/');
    if (parts.length > 1) {
      parts.pop();
      // example:
      // map: '/repos/{owner}/{repo}/collaborators/{username}/permission'
      // to: '/repos/{owner}/{repo}/collaborators/{username}'
      const newUrl = parts.join('/');
      if (githubAppPermissions.paths[newUrl]) {
        debug(`Found permissions for ${newUrl} (removed last segment)`);
        return newUrl;
      }
    }
  }
  return url;
}

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
  #options: GitHubAppsOptions;
  private static _managersForOperations: Map<Operations, GitHubTokenManager> = new Map();
  private static _forceBackgroundTokens: boolean;
  private _apps = new Map<AppPurposeTypes, GitHubAppTokens>();
  private _appsById = new Map<number, GitHubAppTokens>();
  private _appIdToPurpose = new Map<number, AppPurposeTypes>();
  private _appSlugs = new Map<number, string>();
  private _forceInstanceTokensToPurpose: AppPurposeTypes;
  private _allowReadOnlyFallbackToOtherInstallations: boolean;
  private _insights: TelemetryClient;
  private _installationInstances = new Map<number, AppInstallation>();

  private static RegisterManagerForOperations(operations: Operations, manager: GitHubTokenManager) {
    GitHubTokenManager._managersForOperations.set(operations, manager);
  }

  static TryGetTokenManagerForOperations(operations: Operations) {
    return GitHubTokenManager._managersForOperations.get(operations);
  }

  constructor(options: GitHubAppsOptions) {
    if (!options) {
      throw new Error('options required');
    }
    const executionEnvironment = options.executionEnvironment;
    this.#options = options;
    GitHubTokenManager._forceBackgroundTokens =
      executionEnvironment.isJob && !executionEnvironment.enableAllGitHubApps;
    GitHubTokenManager.RegisterManagerForOperations(options.operations, this);
    this._insights = options.operations.providers.insights;
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
    customPurposeConfiguration: GitHubAppConfiguration
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
    appAuthenticationType: GitHubAppAuthenticationType,
    requirements?: GitHubAuthenticationRequirement<any>
  ): Promise<AuthorizationHeaderValue> {
    let installationIdPair: InstallationIdPurposePair = null;
    let foundOptimal = false;
    if (requirements) {
      const { octokitFunction: func, octokitRequest: request } = requirements;
      if (func && request) {
        throw CreateError.InvalidParameters(
          'Only one of octokitFunction or octokitRequest can be provided, not both'
        );
      }
      const friendlyName = func ? requirements.octokitFunctionName : requirements.octokitRequest;
      debug(`Requirements present for ${func ? 'Octokit function' : 'REST API request'} ${friendlyName}`);
      let httpMethod: string = null;
      let url: string = null;
      let parameterLessUrl: string = null;
      if (func) {
        const knownFunctionData = func.endpoint.DEFAULTS;
        httpMethod = knownFunctionData.method;
        url = knownFunctionData.url;
        parameterLessUrl = url;
        // const mapBackName = await endpointToOctokitMethod(httpMethod, url);
      } else if (request) {
        const parsedData = parseMethodFromUrl(request);
        httpMethod = parsedData.method;
        url = parsedData.url;
        parameterLessUrl = removeOctokitParametersFromUrl(url);
      }
      if (!httpMethod || !url) {
        throw CreateError.InvalidParameters(
          `Unable to determine the HTTP method and URL for the request or method to ${friendlyName} call`
        );
        // consider: return null; + warn
      }
      const cleanedUrl = cleanupOctokitLookupUrl(parameterLessUrl);
      let permissions = githubAppPermissions.paths[cleanedUrl] as GitHubPathPermissionDefinitionsByMethod;
      const alternatePermissions = requirements.permissions;
      const { allowBestFaithInstallationForAnyHttpMethod } = requirements;
      const forcePermissionsInLookup = requirements?.permissionsMatchRequired || false;
      if (
        !permissions &&
        requirements.usePermissionsFromAlternateUrl &&
        githubAppPermissions.paths[requirements.usePermissionsFromAlternateUrl]
      ) {
        permissions = githubAppPermissions.paths[
          requirements.usePermissionsFromAlternateUrl
        ] as GitHubPathPermissionDefinitionsByMethod;
      } else if (!permissions && requirements.usePermissionsFromAlternateUrl) {
        const alt = cleanupOctokitLookupUrl(
          removeOctokitParametersFromUrl(requirements.usePermissionsFromAlternateUrl)
        );
        permissions = githubAppPermissions.paths[alt] as GitHubPathPermissionDefinitionsByMethod;
      }
      if (alternatePermissions) {
        permissions = {
          [httpMethod]: alternatePermissions,
        };
      }
      if (!permissions) {
        debug(
          `No known permissions data for the URL ${url} [lookup via ${cleanedUrl}] (requirements ignored)`
        );
        if (forcePermissionsInLookup) {
          throw CreateError.InvalidParameters(
            `GitHubTokenManager: no known permissions data for the URL ${url} [lookup via ${cleanedUrl}] while requiring`
          );
        }
        console.warn(`No known permissions data for the URL ${url} [lookup via ${cleanedUrl}]`);
        this._insights?.trackEvent({
          name: 'GitHubTokenManagerNoPermissionsData',
          properties: {
            url,
            cleanedUrl,
          },
        });
        // consider: return null; + warn
      }
      const supportedMethodForBestFaith = httpMethod === 'GET' || allowBestFaithInstallationForAnyHttpMethod;
      if (
        supportedMethodForBestFaith &&
        appAuthenticationType === GitHubAppAuthenticationType.BestAvailable
      ) {
        debug(
          `Optimal installation requested for a ${httpMethod}${httpMethod !== 'GET' && allowBestFaithInstallationForAnyHttpMethod ? ' (as requirements authorize)' : ''} request ${friendlyName}`
        );
        installationIdPair = await this.getOptimalInstallationPairWithPermission(
          organizationName,
          organizationSettings,
          httpMethod,
          permissions,
          forcePermissionsInLookup
        );
        if (installationIdPair) {
          const { purpose } = installationIdPair;
          debug(
            `smart header(${organizationName}, ${this.getPurposeDisplayId(purpose)}, ${appAuthenticationType})`
          );
          foundOptimal = true;
        } else if (forcePermissionsInLookup) {
          // only auditing for now
          console.warn(
            `GitHubTokenManager: no installations found with the required permissions for the URL ${url} [lookup via ${cleanedUrl}]`
          );
        }
      }
    } else {
      debug('No requirements present');
    }
    // NOTE: the 'permissionsMatchRequired' requirement option is currently only in audit mode
    if (!installationIdPair) {
      debug(
        `getOrganizationAuthorizationHeader(${organizationName}, ${this.getPurposeDisplayId(
          preferredPurpose
        )}, ${appAuthenticationType})`
      );
      installationIdPair = this.getPrioritizedOrganizationInstallationId(
        preferredPurpose,
        organizationName,
        organizationSettings,
        appAuthenticationType
      );
    }
    if (!installationIdPair) {
      throw CreateError.InvalidParameters(
        `GitHubTokenManager: organization ${organizationName} does not have a configured GitHub App installation, or, the installation information is not in this environment. The API preferred purpose was ${getAppPurposeId(
          preferredPurpose
        )} with the selection type ${appAuthenticationType}.`
      );
    }
    if (
      appAuthenticationType === GitHubAppAuthenticationType.BestAvailable &&
      installationIdPair.purpose !== preferredPurpose &&
      !foundOptimal
    ) {
      debug(
        `preferred GitHub App type ${preferredPurpose} not configured for organization ${organizationName}, falling back to ${installationIdPair.purpose}`
      );
    }
    const asCustomPurpose = this.getCustomPurpose(installationIdPair.purpose);
    const asStandardPurpose =
      !asCustomPurpose?.getForOrganizationName && (installationIdPair.purpose as AppPurpose);
    let app: GitHubAppTokens = null;
    let customPurposeConfiguration: GitHubAppConfiguration = null;
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
      `getting installation token for installation ID ${installationIdPair.installationId} and target ${organizationName}`
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

  async getAppForPurpose(purpose: AppPurposeTypes, organizationName?: string) {
    const asCustomPurpose = this.getCustomPurpose(purpose);
    if (asCustomPurpose?.getForOrganizationName) {
      const configForOrganization = asCustomPurpose.getForOrganizationName(organizationName);
      const appId = configForOrganization.appId;
      if (appId) {
        let instance = this._appsById.get(appId);
        if (instance) {
          return instance;
        }
        instance = await this.initializeApp(asCustomPurpose, configForOrganization);
        return instance;
      }
    } else if (asCustomPurpose?.getApplicationConfigurationForInitialization) {
      const config = asCustomPurpose.getApplicationConfigurationForInitialization();
      const appId = config.appId;
      if (appId) {
        let instance = this._appsById.get(appId);
        if (instance) {
          return instance;
        }
        instance = await this.initializeApp(asCustomPurpose, config);
        return instance;
      }
    }
    return this._apps.get(purpose);
  }

  getAnyConfiguredInstallationIdForAppId(operations: Operations, appId: number) {
    const orgs = operations.getOrganizationsIncludingInvisible();
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
    const orgs = shuffle(operations.getOrganizationsIncludingInvisible());
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
    let settings: OrganizationSetting = null;
    try {
      settings = organization.getSettings();
    } catch (error) {
      if (!ErrorHelper.IsNotFound(error)) {
        throw error;
      }
    }
    let expectedAppId: number = null;
    const asCustomPurpose = this.getCustomPurpose(purpose);
    if (asCustomPurpose?.getForOrganizationName) {
      const configForOrganization = asCustomPurpose.getForOrganizationName(organization.name);
      if (configForOrganization.appId) {
        expectedAppId =
          typeof configForOrganization.appId === 'string'
            ? parseInt(configForOrganization.appId, 10)
            : configForOrganization.appId;
      }
    }
    if (settings?.installations) {
      for (const { appId, installationId } of settings.installations) {
        const appIdNumber = typeof appId === 'number' ? appId : parseInt(appId, 10);
        const purposeForApp = this._appIdToPurpose.get(appIdNumber);
        if (
          (expectedAppId && expectedAppId === appIdNumber) ||
          (this._appsById.has(appIdNumber) && purposeForApp && purposeForApp === purpose)
        ) {
          const installIdNumber =
            typeof installationId === 'number' ? installationId : parseInt(installationId, 10);
          return { installationId: installIdNumber, appId: appIdNumber, purpose };
        }
      }
    }
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
    // CONSIDER: with some of the logic in the org-specific installations code, this
    // could be a bit more selective to find apps used significantly less often vs
    // a truly random select as it is now.
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
    const appTokens = await this.getAppForPurpose(purpose, organizationName);
    if (!appTokens) {
      throw CreateError.InvalidParameters(`No app configured yet for purpose ${purpose}`);
    }
    const slug = appTokens.slug;
    if (!slug) {
      throw CreateError.InvalidParameters(`No slug configured for purpose ${purpose}`);
    }
    return this.getAppInformationBySlug(this.operations(), slug);
  }

  async getAppInformationBySlug(operations: Operations, slug: string): Promise<GitHubAppInformation> {
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
    return value as GitHubAppInformation;
  }

  async getInstallationRateLimitInformation(
    operations: Operations,
    organizationName: string,
    appId: number,
    installationId: number
  ) {
    const { github } = operations;
    const { rest } = github.octokit;
    const header = await this.getInstallationAuthorizationHeader(appId, installationId, organizationName);
    const value: GitHubRateLimitResponse = await github.callWithRequirements(
      github.createRequirementsForFunction(header.value, rest.rateLimit.get, 'rateLimit.get'),
      {},
      NoCacheNoBackground
    );
    return value?.resources;
  }

  async getRateLimitInformation(purpose: AppPurposeTypes, organization: Organization) {
    const operations = organization.operations as Operations;
    const settings = organization.getDynamicSettings();
    if (settings?.installations) {
      for (const { appId, installationId } of settings.installations) {
        const purposeForApp = this._appIdToPurpose.get(appId);
        if (this._appsById.has(appId) && purposeForApp && purposeForApp === purpose) {
          try {
            const value = await this.getInstallationRateLimitInformation(
              operations,
              organization.name,
              appId,
              installationId
            );
            if (value?.core) {
              return value.core;
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

  private async getOptimalInstallationPairWithPermission(
    organizationName: string,
    organizationSettings: OrganizationSetting,
    httpMethod: string,
    neededPermissions: GitHubPathPermissionDefinitionsByMethod,
    forcePermissionsInLookup: boolean
  ): Promise<InstallationIdPurposePair> {
    if (this._forceInstanceTokensToPurpose) {
      console.warn(
        `This instance of TokenManager forced the purpose to ${this._forceInstanceTokensToPurpose}`
      );
      return null;
    }
    if (!organizationSettings || !organizationSettings.installations) {
      return null;
    }
    const installations = await this.getAvailableInstallations(
      organizationName,
      organizationSettings.installations
    );
    let installationsWithPermissions = installations.filter((installation) => {
      return installation.supportsPermission(httpMethod, neededPermissions, installation);
    });
    debug(
      `Found ${installationsWithPermissions.length} installations with the needed permissions (${JSON.stringify(neededPermissions)}) and ${installations.length - installationsWithPermissions.length} without`
    );
    installationsWithPermissions = shuffle(installationsWithPermissions);
    // slowing down the quick lookup to reduce console output
    for (const installation of installationsWithPermissions) {
      if (!installation.hasTriedInitializing()) {
        await installation.tryInitializeRateLimits();
      }
    }
    // quick lookup
    for (const installation of installationsWithPermissions) {
      const stats = installation.getRecentGoodRateLimitAvailableWithStats();
      const statsDisplay = stats
        ? `available=${stats.remaining}, percent=${stats.percent.toFixed(2)}, id=${stats.installationId}`
        : 'n/a';
      if (stats && stats.outcome === true) {
        debug(
          `Choosing shuffled installation ${installation.id} with good rate limit ${statsDisplay} and purpose ${this.getPurposeDisplayId(installation.purpose) || 'unknown'}`
        );
        return installation.asPairWithPurpose();
      } else {
        if (stats === false) {
          debug(
            `UNKNOWN RATE LIMIT: Installation ${installation.id} ${statsDisplay} ${this.getPurposeDisplayId(installation.purpose) || 'unknown'}`
          );
        } else {
          debug(
            `LOW/UNKNOWN RATE LIMIT: Installation ${installation.id} ${statsDisplay} ${this.getPurposeDisplayId(installation.purpose) || 'unknown'}`
          );
        }
      }
    }
    // slower lookup
    for (const installation of installationsWithPermissions) {
      await installation.getRecentRateLimits();
      if (installation.hasRecentGoodRateLimitAvailable()) {
        debug(
          `Choosing shuffled installation ${installation.id} with good rate limit availability and purpose ${this.getPurposeDisplayId(installation.purpose) || 'unknown'}`
        );
        return installation.asPairWithPurpose();
      } else {
        debug(
          `LOW RATE LIMIT: Installation ${installation.id} not much available ${this.getPurposeDisplayId(installation.purpose) || 'unknown'}`
        );
      }
    }
    // no great entries...
    for (const installation of installationsWithPermissions) {
      if (installation.hasAnyRateLimitRemaining()) {
        debug(
          `Choosing shuffled installation ${installation.id} with any rate limit remaining and purpose ${this.getPurposeDisplayId(installation.purpose) || 'unknown'}`
        );
        debug(
          `LOW RATE LIMIT: Installation ${installation.id} has some rate limit remaining and will be used`
        );
        this._insights?.trackEvent({
          name: 'GitHubTokenManagerLowRateLimit',
          properties: {
            installationId: installation.id,
            organizationName,
            purpose: this.getPurposeDisplayId(installation.purpose),
          },
        });
        return installation.asPairWithPurpose();
      }
    }
    if (forcePermissionsInLookup) {
      // only auditing for now
      console.warn(`GitHubTokenManager: no installations found with the required permissions`);
    }
    return null;
  }

  private async getAvailableInstallations(organizationName: string, installs: BasicGitHubAppInstallation[]) {
    const { insights } = this.operations().providers;
    const knownInstallations = installs
      .map((install) => this._installationInstances.get(install.installationId))
      .filter((i) => i);
    if (knownInstallations.length === installs.length) {
      return knownInstallations.filter((i) => i.valid);
    }
    const unknownInstallations = installs.filter(
      (install) => !this._installationInstances.has(install.installationId)
    );
    const unknownClonedInstallations: BasicGitHubAppInstallation[] = [];
    for (const install of unknownInstallations) {
      const clonedInstall = { ...install };
      const purposeForApp = this._appIdToPurpose.get(install.appId);
      if (!clonedInstall.appPurposeId && purposeForApp) {
        clonedInstall.appPurposeId = getAppPurposeId(purposeForApp);
      }
      unknownClonedInstallations.push(clonedInstall);
    }
    const throttle = throat(parallelInstallationLearning);

    await throttle(() => {
      return Promise.all(
        unknownClonedInstallations.map(async (install) => {
          const installationInstance = await this.learnAboutInstall(organizationName, install);
          if (!installationInstance || !installationInstance.valid) {
            console.warn(
              `Former appId=${install.appId}, installationId=${install.installationId}, target=${organizationName}`
            );
            insights?.trackEvent({
              name: 'GitHubTokenManagerMissingInstall',
              properties: {
                appId: install.appId,
                installationId: install.installationId,
                organizationName,
              },
            });
            insights?.trackMetric({
              name: 'GitHubTokenManagerMissingInstalls',
              value: 1,
            });
          }
        })
      );
    });

    {
      const knownInstallations = installs
        .map((install) => this._installationInstances.get(install.installationId))
        .filter((i) => i);
      return knownInstallations.filter((i) => i.valid);
    }
  }

  async getInstallationForOrganization(organization: Organization, purpose: AppPurposeTypes) {
    const { installationId } = this.getInstallationIdForOrganization(purpose, organization);
    if (!installationId) {
      throw CreateError.InvalidParameters(
        `No installation ID found for target ${organization.name} and purpose ${purpose}`
      );
    }
    const appForOrg = await this.getAppForPurpose(purpose, organization.name);
    if (!appForOrg) {
      throw CreateError.InvalidParameters(`No app configured for purpose ${purpose}`);
    }
    const availableInstalls = await this.getAvailableInstallations(organization.name, [
      { installationId, appId: appForOrg.appId },
    ]);
    if (availableInstalls.length === 0) {
      throw CreateError.InvalidParameters(
        `No installation found for target ${organization.name} and purpose ${purpose}`
      );
    }
    return availableInstalls[0];
  }

  private async learnAboutInstall(
    organizationName: string,
    install: BasicGitHubAppInstallation
  ): Promise<AppInstallation> {
    let installation: AppInstallation = this._installationInstances.get(install.installationId);
    if (installation?.information) {
      return installation;
    }
    const operations = this.operations();
    const { appId } = install;
    try {
      const purpose = this._appIdToPurpose.get(appId);
      installation = new AppInstallation(operations, organizationName, install, purpose);
      this._installationInstances.set(install.installationId, installation);
      await installation.initialize();
      if (!installation.valid) {
        console.warn(
          `The installation ${install.installationId} of app ID ${install.appId} for ${organizationName}, purpose ${install.appPurposeId || 'unknown'}, isn't valid and will be ignored.`
        );
      }
    } catch (error) {
      if (ErrorHelper.IsServerError(error)) {
        console.warn(
          `GitHub unicorn learning about installation ${install.installationId} for ${organizationName}`
        );
      } else {
        console.warn(
          `Error learning about installation ${install.installationId} for ${organizationName}: ${error.message}`
        );
      }
    }
    return installation;
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

  private async initializeApp(purpose: AppPurposeTypes, appConfig: GitHubAppConfiguration) {
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
    const providers = this.operations().providers;
    debug(`Initializing ${purposeAppId} GitHub App with ID=${appId}`);
    const slug = appConfig.slug;
    const friendlyName = customPurpose?.name || appConfig.description || 'Unknown';
    const baseUrl = appConfig.baseUrl;
    let key = appConfig.appKey;
    let skipDecodingBase64 = false;
    let app: GitHubAppTokens;
    if (appConfig.appKeyRemoteJwt) {
      app = GitHubAppTokens.CreateWithExternalJwtSigning(
        providers,
        purpose,
        slug,
        friendlyName,
        appId,
        appConfig.appKeyRemoteJwt,
        baseUrl
      );
    } else {
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
      app = skipDecodingBase64
        ? GitHubAppTokens.CreateFromString(providers, purpose, slug, friendlyName, appId, key, baseUrl)
        : GitHubAppTokens.CreateFromBase64EncodedFileString(
            providers,
            purpose,
            slug,
            friendlyName,
            appId,
            key,
            baseUrl
          );
    }
    const hasCustomConfigurationByOrganization = customPurpose?.getForOrganizationName;
    const standardPurpose = purpose as AppPurpose;
    if (!hasCustomConfigurationByOrganization) {
      this._apps.set(standardPurpose, app);
    }
    this._appsById.set(appId, app);
    this._appSlugs.set(appId, appConfig.slug);
    this._appIdToPurpose.set(appId, purpose);
    if (customPurpose?.isCustomAppPurpose === true) {
      debug(
        `Custom GitHub App, ${customPurpose.name} (id=${customPurpose.id}, appId=${appId}, slug=${
          appConfig.slug
        }${hasCustomConfigurationByOrganization ? ', target-specific-variance' : ''}) initialized`
      );
    }
    return app;
  }
}
