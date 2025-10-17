//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import Debug from 'debug';
import axios from 'axios';
import lodash from 'lodash';

import { throat } from '../../vendor/throat/index.js';

import {
  OrganizationFeature,
  OrganizationSetting,
} from '../entities/organizationSettings/organizationSetting.js';
import {
  GitHubAppAuthenticationType,
  AppPurpose,
  ICustomAppPurpose,
  AppPurposeTypes,
  GitHubAppConfiguration,
  GitHubAppPurposes,
  getAppPurposeId,
} from '../../lib/github/appPurposes.js';
import { GitHubTokenManager } from '../../lib/github/tokenManager.js';
import {
  IProviders,
  ICacheDefaultTimes,
  ICacheOptions,
  AuthorizationHeaderValue,
  SiteConfiguration,
  ExecutionEnvironment,
  IPagedCacheOptions,
  ICacheOptionsWithPurpose,
  ICachedEmployeeInformation,
  ICorporateLink,
  IPromisedLinks,
  LinkEvent,
  UnlinkEvent,
  GetAuthorizationHeader,
  GitHubRepositoryDetails,
  ICrossOrganizationMembershipByOrganization,
  UnlinkPurpose,
  PurposefulGetAuthorizationHeader,
  IGitHubAppInstallation,
  NoCacheNoBackground,
  SupportedLinkType,
  ICreateLinkOptions,
  ICreatedLinkOutcome,
  ICrossOrganizationTeamMembership,
  IMapPlusMetaCost,
  IPagedCrossOrganizationCacheOptions,
  ISupportedLinkTypeOutcome,
  IUnlinkMailStatus,
} from '../../interfaces/index.js';
import { linkAccounts as linkAccountsMethod } from './link.js';
import { RestLibrary } from '../../lib/github/index.js';
import { CreateError, ErrorHelper } from '../../lib/transitional.js';
import { sortByCaseInsensitive, wrapError } from '../../lib/utils.js';
import { Account } from '../account.js';
import GitHubApplication from '../application.js';
import getCompanySpecificDeployment from '../../middleware/companySpecificDeployment.js';
import { isAuthorizedSystemAdministrator } from './administration.js';
import { createPortalSudoInstance, IPortalSudo } from '../features/sudo/index.js';
import { getGitHubTokenTypeFromValue, GitHubTokenType } from '../../lib/github/appTokens.js';
import { Repository } from '../repository.js';
import { GitHubOrganizationResponse, Organization } from '../organization.js';
import { GraphManager } from '../graphManager.js';

import { ConfigGitHubOrganizationsSpecializedList } from '../../config/github.organizations.types.js';
import { renderHtmlMail } from '../../lib/mail/render.js';
import { sendTerminatedAccountMail as sendTerminatedAccountMailMethod } from './unlinkMail.js';
import { OrganizationSettingProvider } from '../entities/organizationSettings/organizationSettingProvider.js';
import { Team } from '../team.js';

import type { GitHubAppInformation, GitHubAuthenticationRequirement } from '../../lib/github/types.js';
import type { ICacheHelper } from '../../lib/caching/index.js';
import type { ILinkProvider } from '../../lib/linkProviders/index.js';
import type { IRepositoryMetadataProvider } from '../entities/repositoryMetadata/repositoryMetadataProvider.js';
import type { IMail } from '../../lib/mailProvider/index.js';

const { shuffle } = lodash;

const debugGitHubTokens = Debug('github:tokens');

const symbolCost = Symbol('cost');
const symbolHeaders = Symbol('headers');

export const CACHE_PREFIX_MANAGER_INFO = 'employeewithmanager:';
const ParallelLinkLookup = 4;

export function symbolizeApiResponse<T>(response: any): T {
  if (response && response.headers) {
    response[symbolHeaders] = response.headers;
    delete response.headers;
  }
  if (response && response.cost) {
    response[symbolCost] = response.cost;
    delete response.cost;
  }
  return response;
}

export function getApiSymbolMetadata(response: any) {
  if (response) {
    return { headers: response[symbolHeaders], cost: response[symbolCost] };
  }
  throw CreateError.ParameterRequired('response');
}

export interface IOperationsOptions {
  github: RestLibrary;
  providers: IProviders;
  baseUrl?: string;
  executionEnvironment: ExecutionEnvironment;
  repositoryMetadataProvider: IRepositoryMetadataProvider;
}

export enum CacheDefault {
  orgReposStaleSeconds = 'orgReposStaleSeconds',
  orgRepoTeamsStaleSeconds = 'orgRepoTeamsStaleSeconds',
  orgRepoCollaboratorsStaleSeconds = 'orgRepoCollaboratorsStaleSeconds',
  orgRepoCollaboratorStaleSeconds = 'orgRepoCollaboratorStaleSeconds',
  orgRepoDetailsStaleSeconds = 'orgRepoDetailsStaleSeconds',
  orgTeamsStaleSeconds = 'orgTeamsStaleSeconds',
  orgTeamDetailsStaleSeconds = 'orgTeamDetailsStaleSeconds',
  orgTeamsSlugLookupStaleSeconds = 'orgTeamsSlugLookupStaleSeconds',
  orgMembersStaleSeconds = 'orgMembersStaleSeconds',
  teamMaintainersStaleSeconds = 'teamMaintainersStaleSeconds',
  orgMembershipStaleSeconds = 'orgMembershipStaleSeconds',
  orgMembershipDirectStaleSeconds = 'orgMembershipDirectStaleSeconds',
  crossOrgsReposStaleSecondsPerOrg = 'crossOrgsReposStaleSecondsPerOrg',
  crossOrgsReposParallelCalls = 'crossOrgsReposParallelCalls',
  crossOrgsMembersStaleSecondsPerOrg = 'crossOrgsMembersStaleSecondsPerOrg',
  crossOrgsMembersParallelCalls = 'crossOrgsMembersParallelCalls',
  corporateLinksStaleSeconds = 'corporateLinksStaleSeconds',
  repoBranchesStaleSeconds = 'repoBranchesStaleSeconds',
  repoPullsStaleSeconds = 'repoPullsStaleSeconds',
  accountDetailStaleSeconds = 'accountDetailStaleSeconds',
  teamDetailStaleSeconds = 'teamDetailStaleSeconds',
  orgRepoWebhooksStaleSeconds = 'orgRepoWebhooksStaleSeconds',
  teamRepositoryPermissionStaleSeconds = 'teamRepositoryPermissionStaleSeconds',
  defaultStaleSeconds = 'defaultStaleSeconds',
}

// defaults could move to configuration alternatively
const defaults: ICacheDefaultTimes = {
  [CacheDefault.orgReposStaleSeconds]: 60 * 15 /* 15m */,
  [CacheDefault.orgRepoTeamsStaleSeconds]: 60 * 3 /* 3m */,
  [CacheDefault.orgRepoCollaboratorsStaleSeconds]: 60 * 30 /* 30m */,
  [CacheDefault.orgRepoCollaboratorStaleSeconds]: 30 /* half minute */,
  [CacheDefault.orgRepoDetailsStaleSeconds]: 60 * 5 /* 5m */,
  [CacheDefault.orgTeamsStaleSeconds]: 60 * 5 /* 5m */,
  [CacheDefault.orgTeamDetailsStaleSeconds]: 60 * 30 /* 30m */,
  [CacheDefault.orgTeamsSlugLookupStaleSeconds]: 30 /* half a minute */,
  [CacheDefault.orgMembersStaleSeconds]: 60 * 30 /* 30m */,
  [CacheDefault.teamMaintainersStaleSeconds]: 60 * 2 /* 2m */,
  [CacheDefault.orgMembershipStaleSeconds]: 60 * 5 /* 5m */,
  [CacheDefault.orgMembershipDirectStaleSeconds]: 30 /* 30s */,
  [CacheDefault.crossOrgsReposStaleSecondsPerOrg]: 60 * 60 * 2 /* 2 hours per org */,
  [CacheDefault.crossOrgsReposParallelCalls]: 3,
  [CacheDefault.crossOrgsMembersStaleSecondsPerOrg]: 60 * 60 * 2 /* 2 hours per org */,
  [CacheDefault.crossOrgsMembersParallelCalls]: 5,
  [CacheDefault.corporateLinksStaleSeconds]: 30 /* 30s (used to be 5m) */,
  [CacheDefault.repoBranchesStaleSeconds]: 60 * 5 /* 5m */,
  [CacheDefault.repoPullsStaleSeconds]: 60 * 60 /* 60m */,
  [CacheDefault.accountDetailStaleSeconds]: 60 * 60 * 24 /* 24h */,
  [CacheDefault.teamDetailStaleSeconds]: 60 * 60 * 2 /* 2h */,
  [CacheDefault.orgRepoWebhooksStaleSeconds]: 60 * 60 * 8 /* 8h */,
  [CacheDefault.teamRepositoryPermissionStaleSeconds]: 0 /* 0m */,
  [CacheDefault.defaultStaleSeconds]: 60 /* 1m */,
};

export const DefaultPageSize = 100;
const throwIfOrganizationIdsMissing = true;

const SecondsBetweenOrganizationSettingUpdatesCheck = null; // 60 * 2; // every 2 minutes, check for dynamic app updates
let DynamicRestartCheckHandle = null;

export const CACHE_PREFIX_CORPORATE_ID_CHAIN = 'temporary:corporateidchain:'; // @cspell: ignore corporateidchain
export const CACHE_PREFIX_REPOSITORY_OWNERS = 'temporary:repositoryowners:'; // @cspell: ignore repositoryowners

const CACHE_PREFIX_ALL_REPOS = 'crossorg:repos:'; // @cspell: ignore crossorg

const defaultGitHubPageSize = 100;

export type CrossOrganizationMembersResult = Map<number, ICrossOrganizationMembershipByOrganization>;

export type GetInvisibleOrganizationOptions = {
  settings?: OrganizationSetting;
  authenticationType?: GitHubAppAuthenticationType;
  storeInstanceByName?: boolean;
};

type CreateOrganizationOptions = {
  settings: OrganizationSetting;
  appAuthenticationType: GitHubAppAuthenticationType;
  asUncontrolledPublicOnly?: boolean;
  continueOnError?: boolean;
};

export type UnlinkOptions = {
  reason?: string;
  purpose?: UnlinkPurpose;
  unlinkWithoutDrops?: boolean;
  unlinkWithoutUnlink?: boolean;
  additionalMails?: string[];
  neverSendToAccountHolder?: boolean;
  continueOnError?: boolean;
};

type CrossOrgRepoEntry = {
  orgId: number;
  repo: GitHubRepositoryDetails;
};

type CrossOrgRepositoriesCache = {
  repos: CrossOrgRepoEntry[];
};

export interface IOptionWithPageSize {
  per_page?: number;
}

export function getPageSize(operations: Operations, options?: IOptionWithPageSize) {
  if (options?.per_page) {
    return options.per_page;
  }
  if (operations?.defaultPageSize) {
    return operations.defaultPageSize;
  }
  return DefaultPageSize;
}

export function createCacheOptions(
  operations: Operations,
  options?: ICacheOptions,
  cacheDefault: CacheDefault = CacheDefault.defaultStaleSeconds
) {
  const cacheOptions: ICacheOptions = {
    maxAgeSeconds: getMaxAgeSeconds(operations, cacheDefault, options, 60),
  };
  if (options.backgroundRefresh !== undefined) {
    cacheOptions.backgroundRefresh = options.backgroundRefresh;
  }
  return cacheOptions;
}

export function createPagedCacheOptions(
  operations: Operations,
  options?: IPagedCacheOptions,
  cacheDefault: CacheDefault = CacheDefault.defaultStaleSeconds
) {
  const cacheOptions: IPagedCacheOptions = {
    maxAgeSeconds: getMaxAgeSeconds(operations, cacheDefault, options, 60),
  };
  if (options.pageRequestDelay !== undefined) {
    cacheOptions.pageRequestDelay = options.pageRequestDelay;
  }
  if (options.backgroundRefresh !== undefined) {
    cacheOptions.backgroundRefresh = options.backgroundRefresh;
  }
  return cacheOptions;
}

export function popPurpose(options: ICacheOptionsWithPurpose, defaultPurpose: AppPurposeTypes) {
  if (options.purpose) {
    const purpose = options.purpose;
    delete options.purpose;
    return purpose;
  }
  return defaultPurpose;
}

export function getMaxAgeSeconds(
  operations: Operations,
  cacheDefault: CacheDefault,
  options?: ICacheOptions,
  fallback?: number
) {
  if (options && options.maxAgeSeconds !== undefined) {
    return options.maxAgeSeconds as number;
  }
  if (operations.defaults && operations.defaults[cacheDefault] !== undefined) {
    return operations.defaults[cacheDefault] as number;
  }
  return fallback || undefined;
}

export class Operations {
  private _github: RestLibrary;
  private _defaults: ICacheDefaultTimes;
  private _applicationIds: Map<number, GitHubApplication>;
  private _initialized: Date;
  protected _baseUrl: string;
  protected _nativeUrl: string;
  protected _nativeManagementUrl: string;
  protected _organizationsDeliminator = '';
  protected _repositoriesDeliminator = 'repos/';
  private _providers: IProviders;
  protected _skuName: string;
  protected _portalSudo: IPortalSudo;
  protected _tokenManager: GitHubTokenManager;
  protected _cache: ICacheHelper;
  protected _repositoryMetadataProvider: IRepositoryMetadataProvider;
  private _graphManager: GraphManager;

  private _organizationNames: string[];
  private _organizationOriginalNames: any;
  private _organizationNamesWithAuthorizationHeaders: Map<string, PurposefulGetAuthorizationHeader>;

  private _organizations: Map<string, Organization>;
  private _invisibleOrganizations: Map<string, Organization>;
  private _uncontrolledOrganizations: Map<string, Organization>;

  private _organizationIds: Map<number, Organization>;
  private _organizationIdsIncludingInvisible: Map<number, Organization>;
  private _dynamicOrganizationIds: Set<number>;

  private _defaultPageSize: number;

  private _organizationSettings: OrganizationSetting[];
  private _ignoredOrganizationSettings: OrganizationSetting[];
  private _invisibleOrganizationSettings: OrganizationSetting[];

  private _repos: Repository[];
  private _reposRefreshed: Date;

  constructor(options: IOperationsOptions) {
    this._defaults = Object.assign({}, defaults);
    const providers = options.providers;
    this._cache = providers.cacheProvider;
    this._github = options.github || providers.github;
    this._applicationIds = new Map();
    this._baseUrl = '/';
    this._nativeUrl = 'https://github.com/';
    this._nativeManagementUrl = 'https://github.com/orgs/';
    this._skuName = 'GitHub';
    this._providers = providers;
    if (!options.repositoryMetadataProvider) {
      throw CreateError.ParameterRequired('repositoryMetadataProvider');
    }
    this._repositoryMetadataProvider = options.repositoryMetadataProvider;
    const { config } = providers;
    const hasModernGitHubApps = config.github?.app;
    const purposesToConfigurations = new Map<AppPurposeTypes, GitHubAppConfiguration>();
    if (hasModernGitHubApps) {
      for (const purpose of GitHubAppPurposes.AllAvailableAppPurposes) {
        const configKey = getAppPurposeId(purpose);
        const configValue = config.github.app[configKey];
        if (configValue) {
          purposesToConfigurations.set(purpose, configValue);
        }
      }
    }
    this._tokenManager = new GitHubTokenManager({
      operations: this,
      configurations: purposesToConfigurations,
      executionEnvironment: options.executionEnvironment,
    });
    this._graphManager = new GraphManager(this);
    this._uncontrolledOrganizations = new Map();
    this._defaultPageSize =
      this.config && this.config.github && this.config.github.api && this.config.github.api.defaultPageSize
        ? this.config.github.api.defaultPageSize
        : defaultGitHubPageSize;
    this._dynamicOrganizationIds = new Set();
    this._organizationSettings = [];
    this._portalSudo = createPortalSudoInstance(this.providers);
  }

  get repositoryMetadataProvider() {
    return this._repositoryMetadataProvider;
  }

  protected get tokenManager() {
    return this._tokenManager;
  }

  get graphManager(): GraphManager {
    return this._graphManager;
  }

  get defaultPageSize(): number {
    return this._defaultPageSize;
  }

  getRelativeApiUrl(apiUrl: string) {
    const asUrl = new URL(apiUrl);
    const relativeUrl = asUrl.pathname;
    return relativeUrl;
  }

  public get githubSkuName() {
    return this._skuName;
  }

  async getCachedEmployeeManagementInformation(corporateId: string): Promise<ICachedEmployeeInformation> {
    const key = `${CACHE_PREFIX_MANAGER_INFO}${corporateId}`;
    const currentManagerIfAny = await this._cache.getObjectCompressed(key);
    return currentManagerIfAny as ICachedEmployeeInformation;
  }

  async getGitHubAppInformation(slug: string, options?: ICacheOptions) {
    options = options || {};
    const operations = this;
    const cacheOptions: ICacheOptions = {
      maxAgeSeconds: getMaxAgeSeconds(operations, CacheDefault.accountDetailStaleSeconds, options),
    };
    if (options.backgroundRefresh !== undefined) {
      cacheOptions.backgroundRefresh = options.backgroundRefresh;
    }
    const { github } = operations;
    const { rest } = github.octokit;
    const parameters = {
      app_slug: slug,
    };
    try {
      const entity = await github.callWithRequirements(
        github.createRequirementsForFunction(
          this.getPublicAuthorizationToken(),
          rest.apps.getBySlug,
          'apps.getBySlug'
        ),
        parameters,
        cacheOptions
      );
      return entity as GitHubAppInformation;
    } catch (error) {
      if (ErrorHelper.IsNotAuthorized(error)) {
        throw CreateError.Wrap(
          `Not authorized to access GitHub app information for slug "${slug}". Is the app a private app and not public?`,
          error
        );
      }
      throw error;
    }
  }

  async getAccountByUsername(username: string, options?: ICacheOptions): Promise<Account> {
    options = options || {};
    const operations = this;
    if (!username) {
      throw CreateError.ParameterRequired('username');
    }
    const parameters = {
      username: username,
    };
    const cacheOptions: ICacheOptions = {
      maxAgeSeconds: getMaxAgeSeconds(operations, CacheDefault.accountDetailStaleSeconds, options),
    };
    if (options.backgroundRefresh !== undefined) {
      cacheOptions.backgroundRefresh = options.backgroundRefresh;
    }
    try {
      const { github } = operations;
      const { rest } = github.octokit;
      // the public auth token will be used before the requirements approach
      const getHeaderFunction = operations.getPublicAuthorizationToken();
      const entity = await github.callWithRequirements(
        github.createRequirementsForFunction(
          getHeaderFunction,
          rest.users.getByUsername,
          'users.getByUsername'
        ),
        parameters,
        cacheOptions
      );
      const account = new Account(entity, this, getHeaderFunction.bind(null, AppPurpose.Data));
      return account;
    } catch (error) {
      if (error.status && error.status == /* loose */ 404) {
        error = new Error(`The GitHub username ${username} could not be found (or has been deleted)`);
        error.status = 404;
        throw error;
      } else if (error) {
        throw wrapError(error, `Could not get details about account ${username}: ${error.message}`);
      }
    }
  }

  get providers(): IProviders {
    return this._providers;
  }

  get config(): SiteConfiguration {
    return this.providers.config;
  }

  get insights(): any {
    return this.providers.insights;
  }

  get nativeUrl() {
    return this._nativeUrl;
  }

  get nativeManagementUrl() {
    return this._nativeManagementUrl;
  }

  get organizationsDeliminator() {
    return this._organizationsDeliminator;
  }

  get repositoriesDeliminator() {
    return this._repositoriesDeliminator;
  }

  get baseUrl(): string {
    return this._baseUrl;
  }

  get absoluteBaseUrl(): string {
    let baseUrlRoot =
      this.config && this.config.webServer && this.config.webServer.baseUrl
        ? (this.config.webServer.baseUrl as string)
        : null;
    if (baseUrlRoot && baseUrlRoot.endsWith('/')) {
      baseUrlRoot = baseUrlRoot.substr(0, baseUrlRoot.length - 1);
    }
    const baseUrl = baseUrlRoot + this.baseUrl;
    if (baseUrl) {
      return baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
    }
    return '/';
  }

  get initialized(): Date {
    return this._initialized;
  }

  get defaults(): ICacheDefaultTimes {
    return this._defaults;
  }

  get github(): RestLibrary {
    return this._github;
  }

  // Legal entities

  getDefaultLegalEntities(): string[] {
    if (
      this.config.legalEntities &&
      this.config.legalEntities.defaultOrganizationEntities &&
      this.config.legalEntities.defaultOrganizationEntities.length > 0
    ) {
      return this.config.legalEntities.defaultOrganizationEntities as string[];
    }
    return null;
  }

  // Repo templates

  getDefaultRepositoryTemplateNames(): string[] {
    if (
      this.config.github &&
      this.config.github.templates &&
      this.config.github.templates.defaultTemplates &&
      this.config.github.templates.defaultTemplates.length > 0
    ) {
      return this.config.github.templates.defaultTemplates as string[];
    }
    return null;
  }

  // Notification mails

  getOperationsMailAddress(): string {
    return this.config.brand.operationsMail;
  }

  getLinksNotificationMailAddress(): string {
    return this.config.notifications.linksMailAddress || this.getOperationsMailAddress();
  }

  getRepositoriesNotificationMailAddress(): string {
    return this.config.notifications.reposMailAddress || this.getOperationsMailAddress();
  }

  // Links

  getLinks(options?: any): Promise<ICorporateLink[]> {
    // Design change in the TypeScript version: this returns true link objects now,
    // but caches hydrated links behind the scenes
    options = options || {
      includeNames: true,
      includeId: true,
      includeServiceAccounts: true,
    };
    const caching = {
      maxAgeSeconds: options.maxAgeSeconds || this.defaults.corporateLinksStaleSeconds,
      backgroundRefresh: true,
    };
    delete options.maxAgeSeconds;
    delete options.backgroundRefresh;
    const linkProvider = this.providers.linkProvider;
    options.lp = linkProvider.serializationIdentifierVersion;
    return new Promise((resolve, reject) => {
      return this.github.links.getCachedLinks(
        getPromisedLinks.bind(null, linkProvider),
        options,
        caching,
        (ee, ll) => {
          let rehydratedLinks = null;
          if (!ee) {
            try {
              rehydratedLinks = linkProvider.rehydrateLinks(ll);
            } catch (rehydrationError) {
              ee = rehydrationError;
            }
          }
          if (ee) {
            return reject(ee);
          }
          return resolve(rehydratedLinks);
        }
      );
    });
  }

  async getLinksMapFromThirdPartyIds(thirdPartyIds: string[]): Promise<Map<number, ICorporateLink>> {
    const map = new Map<number, ICorporateLink>();
    if (thirdPartyIds.length === 0) {
      return map;
    }
    const group = await this.getLinksFromThirdPartyIds(thirdPartyIds);
    for (const link of group) {
      if (link && link.thirdPartyId) {
        map.set(Number(link.thirdPartyId), link);
      }
    }
    return map;
  }

  async getLinksFromThirdPartyIds(thirdPartyIds: string[]): Promise<ICorporateLink[]> {
    const corporateLinks: ICorporateLink[] = [];
    const throttle = throat(ParallelLinkLookup);
    await Promise.all(
      thirdPartyIds.map((thirdPartyId) =>
        throttle(async () => {
          try {
            const link = await this.getLinkByThirdPartyId(thirdPartyId);
            if (link) {
              corporateLinks.push(link);
            }
          } catch (noLinkError) {
            if (!ErrorHelper.IsNotFound(noLinkError)) {
              console.dir(noLinkError);
            }
          }
        })
      )
    );
    return corporateLinks;
  }

  async getLinksFromCorporateIds(corporateIds: string[]): Promise<ICorporateLink[]> {
    const corporateLinks: ICorporateLink[] = [];
    const throttle = throat(ParallelLinkLookup);
    await Promise.all(
      corporateIds.map((corporateId) =>
        throttle(async () => {
          try {
            const links = await this.providers.linkProvider.queryByCorporateId(corporateId);
            if (links && links.length === 1) {
              corporateLinks.push(links[0]);
            } else if (links.length > 1) {
              throw new Error('Multiple links not supported');
            }
          } catch (noLinkError) {
            console.dir(noLinkError);
          }
        })
      )
    );
    return corporateLinks;
  }

  getLinkByThirdPartyId(thirdPartyId: string): Promise<ICorporateLink> {
    const linkProvider = this.providers.linkProvider;
    return linkProvider.getByThirdPartyId(thirdPartyId);
  }

  getLinkByThirdPartyUsername(username: string): Promise<ICorporateLink> {
    const linkProvider = this.providers.linkProvider;
    return linkProvider.getByThirdPartyUsername(username);
  }

  // Eventually link/unlink should move from context into operations here to centralize more than just the events

  async fireLinkEvent(value: LinkEvent): Promise<void> {
    const companySpecific = getCompanySpecificDeployment();
    if (companySpecific?.events?.linking?.onLink) {
      companySpecific.events.linking.onLink(this.providers, value);
    }
    await fireEvent(this.config, 'link', value);
  }

  async fireUnlinkEvent(value: UnlinkEvent): Promise<void> {
    const corporateId = value?.aad?.id;
    const companySpecific = getCompanySpecificDeployment();
    if (companySpecific?.events?.linking?.onUnlink) {
      companySpecific.events.linking.onUnlink(this.providers, corporateId);
    }
    await fireEvent(this.config, 'unlink', value);
  }

  // System and portal accounts

  get systemAccountsByUsername(): string[] {
    return this.config?.github?.systemAccounts ? this.config.github.systemAccounts.logins : [];
  }

  isSystemAdministrator(corporateId: string, corporateUsername?: string) {
    if (!this.initialized) {
      throw new Error('The application is not yet initialized');
    }
    return isAuthorizedSystemAdministrator(this.providers, corporateId, corporateUsername);
  }

  isPortalSudoer(githubLogin: string, link: ICorporateLink) {
    if (!this.initialized) {
      throw new Error('The application is not yet initialized');
    }
    return this._portalSudo.isSudoer(githubLogin, link);
  }

  isSystemAccountByUsername(username: string): boolean {
    const lc = username.toLowerCase();
    const usernames = this.systemAccountsByUsername;
    for (let i = 0; i < usernames.length; i++) {
      if (usernames[i].toLowerCase() === lc) {
        return true;
      }
    }
    return false;
  }

  getPublicReadOnlyStaticToken(): GetAuthorizationHeader {
    const { config } = this.providers;
    if (config?.github?.operations?.publicAccessToken) {
      const capturedToken = config.github.operations.publicAccessToken;
      return async () => {
        return {
          value: `token ${capturedToken}`,
          purpose: null,
          source: 'public read-only token',
        };
      };
    }
    throw CreateError.InvalidParameters('No configured read-only static token');
  }

  createBoundAuthorizationHeader(
    slug: string,
    settings: OrganizationSetting,
    ownerToken: string | null,
    appAuthenticationType: GitHubAppAuthenticationType,
    purpose?: AppPurposeTypes
  ): GetAuthorizationHeader {
    if (!slug || !settings) {
      throw CreateError.ParameterRequired('slug or settings');
    }
    if (!purpose) {
      purpose = AppPurpose.Data;
    }
    const appPurposeId = getAppPurposeId(purpose);
    return this.getAuthorizationHeader.bind(
      this,
      slug,
      settings,
      ownerToken,
      appAuthenticationType,
      appPurposeId
    );
  }

  getPublicAuthorizationToken(): GetAuthorizationHeader {
    try {
      return this._tokenManager.getAuthorizationHeaderForAnyApp.bind(this._tokenManager);
    } catch (error) {
      return this.getPublicReadOnlyStaticToken();
    }
  }

  getAccount(id: string) {
    const entity = { id };
    return new Account(entity, this, this.getPublicAuthorizationToken.bind(this));
  }

  async getAccountWithDetailsAndLink(id: string): Promise<Account> {
    const account = this.getAccount(id);
    return await account.getDetailsAndLink();
  }

  async getAuthenticatedAccount(token: string): Promise<Account> {
    // Returns an account instance based on the account identified in the token.
    const github = this.github;
    const parameters = {};
    const fullToken = `token ${token}`;
    let tokenType: GitHubTokenType = null;
    try {
      tokenType = getGitHubTokenTypeFromValue(fullToken);
    } catch (error) {
      // ignoring any issue here on identifying the type of token
    }
    try {
      const entity = await github.post(fullToken, 'users.getAuthenticated', parameters);
      const account = new Account(entity, this, this.getPublicAuthorizationToken.bind(this));
      return account;
    } catch (error) {
      throw wrapError(
        error,
        `Could not get details about the authenticated account${
          tokenType ? ' using token type "' + tokenType + '"' : '.'
        }`
      );
    }
  }

  // Mail addresses

  getMailAddressFromCorporateUsername(corporateUsername: string): Promise<string> {
    if (!this.providers.mailAddressProvider) {
      throw new Error('No mailAddressProvider available');
    }
    return this.providers.mailAddressProvider.getAddressFromUpn(corporateUsername);
  }

  async getMailAddressesFromCorporateUsernames(corporateUsernames: string[]): Promise<string[]> {
    // This is a best-faith effort but will not fail if some are not returned.
    const throttle = throat(2);
    const addresses: string[] = [];
    await Promise.all(
      corporateUsernames.map((username) =>
        throttle(async () => {
          try {
            const address = await this.getMailAddressFromCorporateUsername(username);
            if (address) {
              addresses.push(address);
            }
          } catch (ignoreError) {
            console.log('getMailAddressesFromCorporateUsernames error:');
            console.warn(ignoreError);
          }
        })
      )
    );
    return addresses;
  }

  async tryGetLink(id: string, options?): Promise<ICorporateLink> {
    if (this.providers.linkProvider) {
      try {
        const link = await this.getLinkByThirdPartyId(id);
        return link;
      } catch (error) {
        if (ErrorHelper.IsNotFound(error)) {
          return null;
        } else {
          throw error;
        }
      }
    }
    // This literally retrieves the cache of all links, built from a time before link provider.
    const links = await this.getLinks(options);
    const reduced = links.filter((link) => {
      // was 'ghid' in the prior implementation before link interfaces
      return link && link.thirdPartyId == id /* allow string comparisons */;
    });
    if (reduced.length > 1) {
      throw new Error(`Multiple links were present for the same GitHub user ${id}`);
    }
    return reduced.length === 1 ? reduced[0] : null;
  }

  // Feature flags

  allowSelfServiceTeamMemberToMaintainerUpgrades() {
    return this.config?.features?.allowTeamMemberToMaintainerSelfUpgrades === true;
  }

  allowUnauthorizedNewRepositoryLockdownSystemFeature() {
    return this.config?.features?.allowUnauthorizedNewRepositoryLockdownSystem === true;
  }

  allowUnauthorizedForkLockdownSystemFeature() {
    // This feature has a hard dependency on the new repo lockdown system itself
    return (
      this.allowUnauthorizedNewRepositoryLockdownSystemFeature() &&
      this.config &&
      this.config.features &&
      this.config.features.allowUnauthorizedForkLockdownSystem === true
    );
  }

  allowTransferLockdownSystemFeature() {
    // This feature has a hard dependency on the new repo lockdown system itself
    return (
      this.allowUnauthorizedNewRepositoryLockdownSystemFeature() &&
      this.config &&
      this.config.features &&
      this.config.features.allowUnauthorizedTransferLockdownSystem === true
    );
  }

  allowUndoSystem() {
    return this.config?.features?.allowUndoSystem === true;
  }

  async initialize() {
    const tokenManager = this.tokenManager;
    debugGitHubTokens('calling token manager initialize');
    await tokenManager.initialize();
    debugGitHubTokens('reviewing all app IDs from token manager');
    tokenManager.getAppIds().map((appId) => {
      this.initializeAppById(appId);
    });
    this._initialized = new Date();

    const hasModernGitHubApps = this.config.github && this.config.github.app;
    const staticConfiguredOrganizations = this.config?.github?.organizations || [];
    const organizationSettingsProvider = this.providers.organizationSettingsProvider;
    if (hasModernGitHubApps && organizationSettingsProvider) {
      const staticOrganizationSettings = staticConfiguredOrganizations.map((staticOrg) =>
        OrganizationSetting.CreateFromStaticSettings(staticOrg)
      );
      const organizationSettings = [
        ...(await organizationSettingsProvider.queryAllOrganizations()).filter(
          (dynamicOrg) => dynamicOrg.active === true
        ),
        ...staticOrganizationSettings,
      ];
      const unignoredDynamicOrganizations = organizationSettings.filter(
        (d) =>
          !d.hasFeature(OrganizationFeature.Ignore) ||
          (d.hasFeature(OrganizationFeature.Ignore) && d.hasFeature(OrganizationFeature.Invisible))
      );
      this._ignoredOrganizationSettings = organizationSettings.filter(
        (d) => d.hasFeature(OrganizationFeature.Ignore) && !d.hasFeature(OrganizationFeature.Invisible)
      );
      this._invisibleOrganizationSettings = organizationSettings.filter((d) =>
        d.hasFeature(OrganizationFeature.Invisible)
      );
      this._organizationSettings = unignoredDynamicOrganizations;
      // Discover of installations at startup
      const toDiscover = organizationSettings.filter((os) => os.hasFeature('startupDiscover'));
      await this.startupDiscoverInstallations(toDiscover);
      this._dynamicOrganizationIds = new Set(
        unignoredDynamicOrganizations.map((org) => Number(org.organizationId))
      );
    }
    if (
      this._organizationSettings &&
      organizationSettingsProvider &&
      SecondsBetweenOrganizationSettingUpdatesCheck &&
      typeof SecondsBetweenOrganizationSettingUpdatesCheck === 'number'
    ) {
      DynamicRestartCheckHandle = setInterval(
        restartAfterDynamicConfigurationUpdate.bind(
          null,
          10,
          120,
          this.initialized,
          organizationSettingsProvider
        ),
        1000 * SecondsBetweenOrganizationSettingUpdatesCheck
      );
    }
    if (throwIfOrganizationIdsMissing) {
      this.getOrganizationIds();
    }
    return this;
  }

  initializeAppById(appId: number) {
    const tokenManager = this.tokenManager;
    const friendlyName = tokenManager.getSlugById(appId);
    const slug = tokenManager.getSlugById(appId);
    const app = new GitHubApplication(
      this,
      appId,
      slug,
      friendlyName,
      this.getCertificateSha256.bind(this, tokenManager, appId),
      this.getAppAuthorizationHeader.bind(this, tokenManager, appId)
    );
    this._applicationIds.set(appId, app);
    return app;
  }

  getApplicationById(appId: number): GitHubApplication {
    return this._applicationIds.get(appId);
  }

  getApplications(): GitHubApplication[] {
    return Array.from(this._applicationIds.values());
  }

  private getApplicationsAsLogins() {
    return this.getApplications().map((app) => `${app.slug.toLowerCase()}[bot]`);
  }

  isManagedGitHubApplicationLogin(login: string) {
    if (!login.toLowerCase().includes('[bot]')) {
      throw CreateError.InvalidParameters(`The GitHub login ${login} is not a GitHub App`);
    }
    return this.getApplicationsAsLogins().includes(login.toLowerCase());
  }

  protected async getAppAuthorizationHeader(
    tokenManager: GitHubTokenManager,
    appId: number
  ): Promise<string> {
    const app = tokenManager.getAppById(appId);
    if (!app) {
      throw new Error(`TokenManager does not have configuration for the GitHub App id=${appId}`);
    }
    const jwt = await app.getAppAuthenticationToken();
    const value = `bearer ${jwt}`;
    return value;
  }

  private async getCertificateSha256(tokenManager: GitHubTokenManager, appId: number): Promise<string> {
    const app = tokenManager.getAppById(appId);
    if (!app) {
      throw new Error(`TokenManager does not have configuration for the GitHub App id=${appId}`);
    }
    return app.getCertificateSha256();
  }

  protected async getAuthorizationHeader(
    organizationName: string,
    organizationSettings: OrganizationSetting,
    legacyOwnerToken: string,
    appAuthenticationType: GitHubAppAuthenticationType,
    purpose: AppPurposeTypes,
    requirements?: GitHubAuthenticationRequirement<unknown>
  ): Promise<AuthorizationHeaderValue> {
    const customPurpose = purpose as ICustomAppPurpose;
    const isCustomPurpose = customPurpose?.isCustomAppPurpose === true;
    if (
      !isCustomPurpose &&
      !this.tokenManager.organizationSupportsAnyPurpose(organizationName, organizationSettings)
    ) {
      const legacyTokenValue = legacyOwnerToken;
      if (!legacyTokenValue) {
        throw new Error(
          `Organization ${organizationName} is not configured with a GitHub app, Personal Access Token ownerToken configuration value, or a fallback central operations token for the ${
            isCustomPurpose ? customPurpose.name : purpose
          } purpose and the ${appAuthenticationType} type.`
        );
      }
      return {
        value: `token ${legacyTokenValue}`,
        purpose: null,
        source: 'legacyOwnerToken',
      };
    }
    if (!purpose) {
      purpose = AppPurpose.Data;
      console.log(
        `TODO: consider investigating the callback here as to why the getAuthorizationHeader call was not provided a purpose for the ${organizationName} org. falling back to: purpose=${purpose}`
      );
    }
    return this.tokenManager.getOrganizationAuthorizationHeader(
      organizationName,
      purpose,
      organizationSettings,
      appAuthenticationType,
      requirements
    );
  }

  async startupDiscoverInstallations(settings: OrganizationSetting[], alwaysDiscover?: boolean) {
    const discovered = new Map<string, IGitHubAppInstallation[]>();
    try {
      if (!alwaysDiscover && settings.length === 0) {
        return discovered;
      }
      const orgNames = settings.map((s) => s.organizationName.toLowerCase());
      const orgNamesWithoutIds = settings
        .filter((s) => !s.organizationId)
        .map((s) => s.organizationName.toLowerCase());
      // Get the apps
      const apps = this.getApplications();
      for (const app of apps) {
        try {
          const installs = await app.getInstallations(NoCacheNoBackground);
          for (const install of installs) {
            // Backfill ID
            if (orgNamesWithoutIds.includes(install.account.login.toLowerCase())) {
              const org = settings.find(
                (s) => s.organizationName.toLowerCase() === install.account.login.toLowerCase()
              );
              if (org) {
                org.organizationId = install.account.id;
              }
            }
            // Installation
            let foundOrg = false;
            if (orgNames.includes(install.account.login.toLowerCase())) {
              const org = settings.find(
                (s) => s.organizationName.toLowerCase() === install.account.login.toLowerCase()
              );
              if (org) {
                foundOrg = true;
                org.installations.push({
                  installationId: install.id,
                  appId: app.id,
                });
              }
            }
            if (!foundOrg) {
              let installs = discovered.get(install.account.login.toLowerCase());
              if (!installs) {
                installs = [];
                discovered.set(install.account.login.toLowerCase(), installs);
              }
              installs.push(install);
            }
          }
        } catch (error) {
          console.log(error);
        }
      }
    } catch (error) {
      console.dir(error);
    }
    return discovered;
  }

  get organizationNames(): string[] {
    if (!this._organizationNames) {
      const names = [];
      const processed = new Set<string>();
      for (const dynamic of this._organizationSettings) {
        if (!dynamic.hasFeature(OrganizationFeature.Invisible)) {
          const lowercase = dynamic.organizationName.toLowerCase();
          processed.add(lowercase);
          names.push(lowercase);
        }
      }
      this._organizationNames = names.sort(sortByCaseInsensitive);
    }
    return this._organizationNames;
  }

  getOrganizationSettingsInstance(name: string) {
    return this._organizationSettings.find((s) => s.organizationName.toLowerCase() === name.toLowerCase());
  }

  getOrganizationSettings() {
    return this._organizationSettings;
  }

  getIgnoredOrganizationSettings(): OrganizationSetting[] {
    return this._ignoredOrganizationSettings;
  }

  getInvisibleOrganizationSettings(): OrganizationSetting[] {
    return this._invisibleOrganizationSettings;
  }

  getOrganizationIds(): number[] {
    if (!this._organizationIds) {
      this._organizationIds = new Map();
      this._organizationIdsIncludingInvisible = new Map();
      [...this._organizationSettings, ...this._invisibleOrganizationSettings].map((entry) => {
        if (!entry.active) {
          return;
        }
        const org = this.getOrganization(entry.organizationName.toLowerCase());
        const isInvisible = entry.hasFeature(OrganizationFeature.Invisible);
        this._organizationIdsIncludingInvisible.set(Number(entry.organizationId), org);
        if (!isInvisible) {
          this._organizationIds.set(Number(entry.organizationId), org);
        }
      });
    }
    return Array.from(this._organizationIds.keys());
  }

  private createOrganization(name: string, options: CreateOrganizationOptions): Organization {
    name = name.toLowerCase();
    if (!options) {
      throw CreateError.ParameterRequired('options');
    }
    const { settings, appAuthenticationType, asUncontrolledPublicOnly } = options;
    if (!settings) {
      throw CreateError.InvalidParameters(
        `This application does not have configuration information for the ${name} organization`
      );
    }
    const ownerToken = settings.getOwnerToken();
    const hasDynamicSettings =
      this._dynamicOrganizationIds &&
      settings.organizationId &&
      this._dynamicOrganizationIds.has(Number(settings.organizationId));
    let configuredGetAuthorizationHeader: GetAuthorizationHeader = this.getAuthorizationHeader.bind(
      this,
      name,
      settings,
      ownerToken,
      appAuthenticationType
    );
    let forcedGetAuthorizationHeader: GetAuthorizationHeader = this.getAuthorizationHeader.bind(
      this,
      name,
      settings,
      ownerToken,
      GitHubAppAuthenticationType.ForceSpecificInstallation
    );
    if (!ownerToken && asUncontrolledPublicOnly) {
      configuredGetAuthorizationHeader = this.getPublicAuthorizationToken();
      forcedGetAuthorizationHeader = configuredGetAuthorizationHeader;
    }
    return new Organization(
      this,
      name,
      settings,
      configuredGetAuthorizationHeader,
      forcedGetAuthorizationHeader,
      hasDynamicSettings
    );
  }

  get organizations() {
    if (!this._organizations) {
      const organizations = new Map<string, Organization>();
      const names = this.organizationNames;
      for (let i = 0; i < names.length; i++) {
        const name = names[i];
        let settings: OrganizationSetting = null;
        for (const dos of this._organizationSettings) {
          if (
            dos.active &&
            dos.organizationName.toLowerCase() === name.toLowerCase() &&
            !dos.hasFeature(OrganizationFeature.Invisible)
          ) {
            settings = dos;
          }
        }
        const organization = this.createOrganization(name, {
          settings,
          appAuthenticationType: GitHubAppAuthenticationType.BestAvailable,
        });
        organizations.set(name, organization);
      }
      this._organizations = organizations;
    }
    return this._organizations;
  }

  private getAlternateOrganization(name: string, alternativeType) {
    // An 'alternate' organization is one whose static settings come from a
    // different location within the github.organizations config file.
    const lowercase = name.toLowerCase();
    const list = this.config.github.organizations[
      alternativeType
    ] as any as ConfigGitHubOrganizationsSpecializedList;
    if (list?.length) {
      for (let i = 0; i < list.length; i++) {
        const settings = list[i];
        if (settings && settings.name && settings.name.toLowerCase() === lowercase) {
          return this.createOrganization(lowercase, {
            settings: OrganizationSetting.CreateFromStaticSettings(settings),
            appAuthenticationType: GitHubAppAuthenticationType.BestAvailable,
          });
        }
      }
    }
  }

  getOnboardingOrganization(name: string) {
    // Specialized method to retrieve a new organization via the onboarding configuration collection, if any
    const value = this.getAlternateOrganization(name, 'onboarding');
    if (value) {
      return value;
    }
    throw new Error(`No onboarding organization settings configured for the ${name} organization`);
  }

  getUnconfiguredOrganization(settings: OrganizationSetting): Organization {
    return this.createOrganization(settings.organizationName.toLowerCase(), {
      settings,
      appAuthenticationType: GitHubAppAuthenticationType.BestAvailable,
    });
  }

  // An invisible organization does not appear in the cross-organization
  // views or arrays provided by operations. However, they can still be
  // retrieved directly and connected to live tokens and objects.
  getInvisibleOrganization(name: string, options?: GetInvisibleOrganizationOptions) {
    if (!this._invisibleOrganizations) {
      this._invisibleOrganizations = new Map();
    }
    const lowercase = name.toLowerCase();
    if (this._invisibleOrganizations.has(lowercase) && options?.storeInstanceByName) {
      return this._invisibleOrganizations.get(lowercase);
    }
    let dynamicSettings: OrganizationSetting = null;
    this._organizationSettings.map((dos) => {
      if (
        dos.active &&
        dos.organizationName.toLowerCase() === lowercase &&
        dos.hasFeature(OrganizationFeature.Invisible)
      ) {
        dynamicSettings = dos;
      }
    });
    if (!dynamicSettings && !options?.settings) {
      throw CreateError.InvalidParameters(
        `No organization settings available or configured for the ${name} organization`
      );
    }
    if (options?.settings) {
      dynamicSettings = options.settings;
    }
    const authenticationType = options?.authenticationType || GitHubAppAuthenticationType.BestAvailable;
    const organization = this.createOrganization(name, {
      settings: dynamicSettings,
      appAuthenticationType: authenticationType,
    });
    if (!options || options?.storeInstanceByName) {
      this._invisibleOrganizations.set(name, organization);
    }
    return organization;
  }

  getUncontrolledOrganization(organizationName: string, organizationId?: number): Organization {
    organizationName = organizationName.toLowerCase();
    const officialOrganization = this.organizations.get(organizationName);
    if (officialOrganization) {
      return officialOrganization;
    }
    if (this._uncontrolledOrganizations.has(organizationName)) {
      return this._uncontrolledOrganizations.get(organizationName);
    }
    const emptySettings = new OrganizationSetting();
    emptySettings.operationsNotes = `Uncontrolled Organization - ${organizationName}`;
    const asUncontrolledPublicOnly = true;
    const org = this.createOrganization(organizationName, {
      settings: emptySettings,
      appAuthenticationType: GitHubAppAuthenticationType.ForceSpecificInstallation,
      asUncontrolledPublicOnly,
    });
    this._uncontrolledOrganizations.set(organizationName, org);
    org.uncontrolled = true;
    return org;
  }

  getPublicOnlyAccessOrganization(organizationName: string, organizationId?: number): Organization {
    organizationName = organizationName.toLowerCase();
    const publicAccessToken = this.config.github.operations.publicAccessToken;
    if (!publicAccessToken) {
      throw CreateError.InvalidParameters('not configured for public read-only tokens');
    }
    const emptySettings = OrganizationSetting.CreateEmptyWithOldToken(
      publicAccessToken,
      `Uncontrolled public organization - ${organizationName}`,
      organizationId
    );
    const org = this.createOrganization(organizationName, {
      settings: emptySettings,
      appAuthenticationType: GitHubAppAuthenticationType.ForceSpecificInstallation,
    });
    this._uncontrolledOrganizations.set(organizationName, org);
    org.uncontrolled = true;
    return org;
  }

  isIgnoredOrganization(name: string): boolean {
    const value =
      this.getAlternateOrganization(name, 'onboarding') || this.getAlternateOrganization(name, 'ignore');
    return !!value;
  }

  isManagedOrganization(name: string) {
    try {
      const organization = this.getOrganization(name.toLowerCase());
      if (this.isTreatedAsUnmanaged(organization)) {
        return false;
      }
      return true;
    } catch (unmanaged) {
      return this.isIgnoredOrganization(name);
    }
  }

  private isTreatedAsUnmanaged(organization: Organization) {
    if (organization?.hasDynamicSettings) {
      const settings = organization.getDynamicSettings();
      // NOTE: this is currently only set for EMU side-by-side orgs
      if (
        settings.hasFeature(OrganizationFeature.Ignore) &&
        settings.hasFeature(OrganizationFeature.Invisible) &&
        settings.hasFeature(OrganizationFeature.Hidden)
      ) {
        console.warn(
          `The ${organization.name} organization is configured as ignored, invisible, and hidden; will be treated as unmanaged.`
        );
        return true;
      }
    }
    return false;
  }

  getOrganizations(organizationList?: string[]): Organization[] {
    if (!organizationList) {
      return Array.from(this.organizations.values());
    }
    const references = [];
    organizationList.forEach((orgName) => {
      const organization = this.getOrganization(orgName);
      references.push(organization);
    });
    return references;
  }

  getInvisibleOrganizations() {
    const orgs: Organization[] = [];
    for (const settings of this._invisibleOrganizationSettings) {
      const org = this.getInvisibleOrganization(settings.organizationName);
      orgs.push(org);
    }
    return orgs;
  }

  getOrganizationsIncludingInvisible() {
    const orgs = [...this.getOrganizations(), ...this.getInvisibleOrganizations()];
    orgs.sort((a, b) => {
      return a.name.localeCompare(b.name);
    });
    return orgs;
  }

  getPrimaryOrganizationName(): string {
    const id =
      this.config.github &&
      this.config.github.operations &&
      this.config.github.operations.primaryOrganizationId
        ? this.config.github.operations.primaryOrganizationId
        : null;
    if (id) {
      return this.getOrganizationById(Number(id)).name;
    }
    return this.getOrganizationOriginalNames()[0];
  }

  private getOrganizationOriginalNames(): string[] {
    if (!this._organizationOriginalNames) {
      const names: string[] = [];
      const visited = new Set<string>();
      for (const entry of this._organizationSettings) {
        if (entry.active && !entry.hasFeature(OrganizationFeature.Invisible)) {
          names.push(entry.organizationName);
          const lowercase = entry.organizationName.toLowerCase();
          visited.add(lowercase);
        }
      }
      this._organizationOriginalNames = names.sort(sortByCaseInsensitive);
    }
    return this._organizationOriginalNames;
  }

  translateOrganizationNamesFromLowercase(object) {
    const orgs = this.getOrganizationOriginalNames();
    orgs.forEach((name) => {
      const lc = name.toLowerCase();
      if (name !== lc && object[lc] !== undefined) {
        object[name] = object[lc];
        delete object[lc];
      }
    });
    return object;
  }

  get organizationNamesWithAuthorizationHeaders() {
    if (!this._organizationNamesWithAuthorizationHeaders) {
      const tokens = new Map<string, PurposefulGetAuthorizationHeader>();
      const visited = new Set<string>();
      for (const entry of this._organizationSettings) {
        const lowercase = entry.organizationName.toLowerCase();
        if (entry.active && !visited.has(lowercase) && !entry.hasFeature(OrganizationFeature.Invisible)) {
          visited.add(lowercase);
          const orgInstance = this.getOrganization(lowercase);
          const token = orgInstance.getAuthorizationHeader(AppPurpose.Data);
          tokens.set(lowercase, token);
        }
      }
      this._organizationNamesWithAuthorizationHeaders = tokens;
    }
    return this._organizationNamesWithAuthorizationHeaders;
  }

  linkAccounts(options: ICreateLinkOptions): Promise<ICreatedLinkOutcome> {
    return linkAccountsMethod(this, options);
  }

  async validateCorporateAccountCanLink(corporateId: string): Promise<ISupportedLinkTypeOutcome> {
    const { graphProvider } = this.providers;
    const graphEntry = await graphProvider.getUserAndManagerById(corporateId);
    // NOTE: This assumption, that a user without a manager must be a Service Account,
    // is a bit of a hack. It means that the CEO will be flagged as a service account if
    // they find the time to use this app. This code prioritizes the more common scenario,
    // that a user without an assigned manager in the directory is a Service Account.
    if (graphEntry && !graphEntry.manager) {
      return { type: SupportedLinkType.ServiceAccount, graphEntry };
    }
    return { type: SupportedLinkType.User, graphEntry };
  }

  async terminateLinkAndMemberships(thirdPartyId: string, options?: UnlinkOptions): Promise<string[]> {
    const insights = this.insights;
    options = options || {};
    const history: string[] = [];
    const continueOnError = options.continueOnError || false;
    let errors = 0;
    const account: Account = this.getAccount(thirdPartyId);
    const reason = options.reason || 'Automated processPendingUnlink operation';
    const purpose = (options.purpose as UnlinkPurpose) || UnlinkPurpose.Unknown;
    const unlinkWithoutDrops = options.unlinkWithoutDrops || false;
    const unlinkWithoutUnlink = options.unlinkWithoutUnlink || false;
    try {
      // Uses an ID-based lookup on GitHub in case the user was renamed.
      // Also retrieves the link into memory in the account instance.
      await account.getDetailsAndDirectLink(/* do not throw if deleted account */ false);
    } catch (noDirectDetails) {
      ++errors;
      insights?.trackException({ exception: noDirectDetails });
      // not a fatal error in this method however
      history.push(noDirectDetails.toString());
    }
    const deleted = account?.deleted;
    if (deleted) {
      history.push(`GitHub account was previously deleted by the user.`);
    }
    insights?.trackEvent({
      name: 'UserUnlinkStart',
      properties: {
        id: account.id,
        login: account.login,
        deleted,
        reason,
        purpose,
        continueOnError: continueOnError ? 'continue on errors' : 'halt on errors',
      },
    });
    // GitHub organization memberships
    if (!deleted) {
      try {
        if (unlinkWithoutDrops) {
          history.push('This environment is configured to skip unlinking GitHub organization memberships.');
        } else {
          const removal = await account.removeManagedOrganizationMemberships();
          history.push(...removal.history);
          if (removal.error) {
            throw removal.error; // unclear if this is actually ideal
          }
        }
      } catch (removeOrganizationsError) {
        ++errors;
        // If a removal error occurs, do not remove the link and throw and error
        // so that the link data and information is still present until the issue
        // can be cleared
        insights?.trackException({ exception: removeOrganizationsError });
        if (!continueOnError) {
          throw removeOrganizationsError;
        }
        history.push(`Organization removal error: ${removeOrganizationsError.toString()}`);
      }
    }
    // Collaborator permissions to repositories
    if (!deleted) {
      try {
        if (unlinkWithoutDrops) {
          history.push(
            'This environment is configured to skip unlinking additional GitHub repository grants.'
          );
        } else {
          const removed = await account.removeCollaboratorPermissions();
          history.push(...removed.history);
          if (removed.error) {
            throw removed.error;
          }
        }
      } catch (removeCollaboratorsError) {
        ++errors;
        insights?.trackException({ exception: removeCollaboratorsError });
        if (account.id && !account.login) {
          // If the account information could not be resolved through the
          // GitHub API for this _id_, then the user deleted their account,
          // or is using a different one now, etc., so try deleting the
          // associated link still by searching for it by _ID_.
          // TODO: Ported code from account.ts, remains unimp. It's OK.
        }
        if (!continueOnError) {
          throw removeCollaboratorsError;
        }
        history.push(`Collaborator remove error: ${removeCollaboratorsError.toString()}`);
      }
    }
    const companySpecific = getCompanySpecificDeployment();
    if (companySpecific?.features?.enterprises?.onUnlink) {
      try {
        await companySpecific.features.enterprises.onUnlink(this.providers, account.id, options, history);
      } catch (error) {
        insights?.trackException({ exception: error });
        console.warn(`Error during company-specific unlink operations: ${error}`);
      }
    }
    try {
      if (account.link) {
        if (unlinkWithoutUnlink) {
          history.push('This environment is configured to skip removing the actual link.');
        } else {
          history.push(...(await account.removeLink()));
        }
      }
    } catch (removeLinkError) {
      ++errors;
      insights?.trackException({ exception: removeLinkError });
      if (account.id && !account.login) {
        // If the account information could not be resolved through the
        // GitHub API for this _id_, then the user deleted their account,
        // or is using a different one now, etc., so try deleting the
        // associated link still by searching for it by _ID_.
        // TODO: Ported code from account.ts, remains unimp. It's OK.
      }
      if (!continueOnError) {
        throw removeLinkError;
      }
      history.push(`Unlink error: ${removeLinkError.toString()}`);
    }
    if (unlinkWithoutDrops && !unlinkWithoutUnlink) {
      history.push(
        'Unlink operation completed without removing memberships due to a debug configuration value.'
      );
    } else if (unlinkWithoutDrops && unlinkWithoutUnlink) {
      history.push('Unlink operation is a no-op as configured.');
    }
    try {
      const neverSendToAccountHolder = options?.neverSendToAccountHolder || false;
      const additionalMails = options?.additionalMails || [];
      const status = await this.sendTerminatedAccountMail(
        account,
        purpose,
        history,
        errors,
        neverSendToAccountHolder,
        reason,
        additionalMails
      );
      if (status) {
        history.push(
          `Unlink e-mail sent to manager: to=${status.to.join(', ')} bcc=${status.bcc.join(', ')}, receipt=${
            status.receipt
          }`
        );
      } else {
        history.push('Service not configured to notify by mail');
      }
    } catch (notifyTerminationMailError) {
      insights?.trackException({ exception: notifyTerminationMailError });
      // Notification should never throw
      history.push('Unlink e-mail COULD NOT be sent to manager');
    }
    insights?.trackEvent({
      name: 'UserUnlink',
      properties: {
        id: account.id,
        login: account.login,
        reason,
        purpose,
        continueOnError: continueOnError ? 'continue on errors' : 'halt on errors',
        history: JSON.stringify(history),
      },
    });
    return history;
  }

  private sendTerminatedAccountMail(
    account: Account,
    purpose: UnlinkPurpose,
    details: string[],
    errorsCount: number,
    neverSendToAccountHolder: boolean,
    customUnlinkReason: string,
    additionalMails: string[]
  ): Promise<IUnlinkMailStatus> {
    return sendTerminatedAccountMailMethod(
      this,
      account,
      purpose,
      details,
      errorsCount,
      neverSendToAccountHolder,
      customUnlinkReason,
      additionalMails
    );
  }

  getOrganization(name: string): Organization {
    if (!name) {
      throw CreateError.ParameterRequired('name');
    }
    const lc = name.toLowerCase();
    let organization = this.organizations.get(lc);
    if (!organization) {
      try {
        organization = this.getInvisibleOrganization(name);
      } catch (notInvisible) {
        //
      }
      if (!organization) {
        throw CreateError.NotFound(`Could not find configuration for the "${name}" organization.`);
      }
    }
    return organization;
  }

  isOrganizationManagedById(organizationId: number): boolean {
    try {
      const organization = this.getOrganizationById(organizationId);
      if (this.isTreatedAsUnmanaged(organization)) {
        return false;
      }
      return true;
    } catch (notConfigured) {
      return false;
    }
  }

  getOrganizationById(organizationId: number): Organization {
    if (typeof organizationId === 'string') {
      organizationId = parseInt(organizationId, 10);
      console.warn(`getOrganizationById: organizationId must be a number`);
    }
    if (!this._organizationIdsIncludingInvisible) {
      this.getOrganizationIds();
    }
    const org = this._organizationIdsIncludingInvisible.get(organizationId);
    if (!org) {
      throw CreateError.NotFound(
        `getOrganizationById: no configured ID for an organization with ID ${organizationId}`
      );
    }
    return org;
  }

  async getRepos(options?: ICacheOptions): Promise<Repository[]> {
    const now = new Date();
    const { crossOrgsReposStaleSecondsPerOrg } = this.defaults;
    if (!options && this._repos && this._reposRefreshed) {
      const secondsSinceLastRefresh = (now.getTime() - this._reposRefreshed.getTime()) / 1000;
      if (secondsSinceLastRefresh < crossOrgsReposStaleSecondsPerOrg) {
        return this._repos;
      }
    }
    try {
      const cachedRepos =
        await this._cache.getObjectCompressed<CrossOrgRepositoriesCache>(CACHE_PREFIX_ALL_REPOS);
      if (cachedRepos && cachedRepos.repos && cachedRepos.repos.length > 0 && cachedRepos.repos[0].repo?.id) {
        const repos: Repository[] = [];
        for (const entry of cachedRepos.repos) {
          const org = this.getOrganizationById(entry.orgId);
          const repo = org?.repository(entry.repo.name, entry.repo);
          if (repo?.id) {
            repos.push(repo);
          }
        }
        this._repos = repos;
        this._reposRefreshed = now;
        return repos;
      }
    } catch (error) {
      console.warn(`Error retrieving cached cross-org repositories: ${error}`);
    }
    const repos: Repository[] = [];
    const cached: CrossOrgRepoEntry[] = [];
    const cacheOptions = options || {
      maxAgeSeconds: crossOrgsReposStaleSecondsPerOrg,
    };
    // CONSIDER: Cross-org functionality might be best in the GitHub library itself
    const refreshOrganization = async (organization: Organization) => {
      try {
        const organizationRepos = await organization.getRepositories(cacheOptions);
        repos.push(...organizationRepos);
        for (const repo of organizationRepos) {
          if (repo.id) {
            cached.push({
              orgId: organization.id,
              repo: repo.getEntity(),
            });
          }
        }
      } catch (orgReposError) {
        console.log(`Org: ${organization.id} - Error retrieving repositories: ${orgReposError}`);
      }
    };
    const throttle = throat(/* parallel */ 4);
    await Promise.all(
      Array.from(this.organizations.values()).map((organization) => {
        return throttle(() => {
          return refreshOrganization(organization);
        });
      })
    );
    try {
      const toSet: CrossOrgRepositoriesCache = {
        repos: cached,
      };
      const cacheMinutes = crossOrgsReposStaleSecondsPerOrg / 60;
      this._cache.setObjectCompressedWithExpire(CACHE_PREFIX_ALL_REPOS, toSet, cacheMinutes);
    } catch (cacheError) {
      console.warn(`Error caching cross-org repositories: ${cacheError}`);
    }
    if (repos.length > 0) {
      this._repos = repos;
      this._reposRefreshed = now;
    }
    return repos;
  }

  async getRepoById(repoId: number, options?: ICacheOptions): Promise<Repository> {
    const { repositoryCacheProvider } = this.providers;
    if (repositoryCacheProvider) {
      try {
        const cachedRepository = await repositoryCacheProvider.getRepository(String(repoId));
        if (cachedRepository?.organizationId) {
          const organization = this.getOrganizationById(Number(cachedRepository.organizationId));
          return organization.repository(cachedRepository.repositoryName);
        }
      } catch (error) {
        if (!ErrorHelper.IsNotFound(error)) {
          console.log(`Repository ${repoId} error retrieving from cache: ${error}`);
        }
      }
    }
    const cacheOptions = options || {
      maxAgeSeconds: this.defaults.crossOrgsReposStaleSecondsPerOrg,
    };
    const orgs = this.organizations.values();
    let repository: Repository;
    for (const organization of orgs) {
      try {
        repository = await organization.getRepositoryById(repoId, cacheOptions);
        if (repository) {
          return repository;
        }
      } catch (err) {
        if (!ErrorHelper.IsNotFound(err)) {
          console.error(err);
        }
      }
    }
  }

  async getOrganizationProfileById(id: number, options?: ICacheOptions): Promise<GitHubOrganizationResponse> {
    options = options || {};
    if (!id) {
      throw new Error('Must provide a repository ID to retrieve the repository.');
    }
    if (!this._organizationIdsIncludingInvisible) {
      this.getOrganizationIds();
    }
    const organization = this._organizationIdsIncludingInvisible.get(id);
    return this._getOrganizationProfileById(id, organization ? id : null, options);
  }

  async getOrganizationPublicProfileById(
    id: number,
    options?: ICacheOptions
  ): Promise<GitHubOrganizationResponse> {
    options = options || {};
    if (!id) {
      throw new Error('Must provide a repository ID to retrieve the repository.');
    }
    if (!this._organizationIdsIncludingInvisible) {
      this.getOrganizationIds();
    }
    let lookupId: number | null = this._organizationIdsIncludingInvisible.get(id) ? id : null;
    if (lookupId) {
      const orgIds = Array.from(this._organizationIdsIncludingInvisible.keys());
      const allIdsExcludingOrg = orgIds.filter((orgId) => orgId !== id);
      const shuffledIds = shuffle(allIdsExcludingOrg);
      if (shuffledIds.length > 0) {
        lookupId = shuffledIds[0];
      }
    }
    if (lookupId === null) {
      throw CreateError.InvalidParameters(
        'This approach requires configuring at least two organizations (getOrganizationPublicProfileById).'
      );
    }
    return this._getOrganizationProfileById(id, lookupId, options);
  }

  private async _getOrganizationProfileById(
    id: number,
    lookupUsingIdOrCentralToken: number | null,
    options?: ICacheOptions
  ): Promise<GitHubOrganizationResponse> {
    // EMU note: you need to use an EMU-installed app vs public...
    // Cache note: this will be a cache miss if you switch between public/non-public entrypoints
    options = options || {};
    if (!id) {
      throw new Error('Must provide a repository ID to retrieve the repository.');
    }
    if (!this._organizationIdsIncludingInvisible) {
      this.getOrganizationIds();
    }
    const parameters = {
      id,
    };
    const cacheOptions: ICacheOptions = {
      maxAgeSeconds: getMaxAgeSeconds(this, CacheDefault.accountDetailStaleSeconds, options),
    };
    if (options.backgroundRefresh !== undefined) {
      cacheOptions.backgroundRefresh = options.backgroundRefresh;
    }
    const organization = this._organizationIdsIncludingInvisible.get(lookupUsingIdOrCentralToken);
    let header: GetAuthorizationHeader = null;
    if (organization) {
      header = organization.getAuthorizationHeader(AppPurpose.Data) as GetAuthorizationHeader;
    } else {
      header = this.getPublicAuthorizationToken();
    }
    const { github } = this;
    try {
      const entity = await github.requestWithRequirements(
        github.createRequirementsForRequest(header, 'GET /organizations/:id', {
          usePermissionsFromAlternateUrl: '/orgs/{org}',
        }),
        parameters,
        cacheOptions
      );
      return entity;
    } catch (error) {
      if (error.status && error.status === 404) {
        error = new Error(`The GitHub organization ID ${id} could not be found`);
        error.status = 404;
        throw error;
      }
      throw wrapError(error, `Could not get details about organization ID ${id}: ${error.message}`);
    }
  }

  getTeamsWithMembers(options?: ICrossOrganizationTeamMembership): Promise<any> {
    const cacheOptions: IPagedCrossOrganizationCacheOptions = {};
    options = options || {};
    cacheOptions.backgroundRefresh =
      options.backgroundRefresh !== undefined ? options.backgroundRefresh : true;
    cacheOptions.maxAgeSeconds = options.maxAgeSeconds || 60 * 10;
    cacheOptions.individualMaxAgeSeconds = options.individualMaxAgeSeconds;
    delete options.backgroundRefresh;
    delete options.maxAgeSeconds;
    delete options.individualMaxAgeSeconds;
    return this.github.crossOrganization.teamMembers(
      this as Operations,
      this.organizationNamesWithAuthorizationHeaders,
      options,
      cacheOptions
    );
  }

  // getRepoCollaborators(options: IPagedCrossOrganizationCacheOptions): Promise<any> {
  //   const cacheOptions: IPagedCrossOrganizationCacheOptions = {};
  //   options = options || {};
  //   cacheOptions.backgroundRefresh =
  //     options.backgroundRefresh !== undefined ? options.backgroundRefresh : true;
  //   cacheOptions.maxAgeSeconds = options.maxAgeSeconds || 60 * 10;
  //   cacheOptions.individualMaxAgeSeconds = options.individualMaxAgeSeconds;
  //   delete options.backgroundRefresh;
  //   delete options.maxAgeSeconds;
  //   delete options.individualMaxAgeSeconds;
  //   return this.github.crossOrganization.repoCollaborators(
  //     this as Operations,
  //     this.organizationNamesWithAuthorizationHeaders,
  //     options,
  //     cacheOptions
  //   );
  // }

  getRepoTeams(options: IPagedCrossOrganizationCacheOptions): Promise<any> {
    const cacheOptions: IPagedCrossOrganizationCacheOptions = {};
    options = options || {};
    cacheOptions.backgroundRefresh =
      options.backgroundRefresh !== undefined ? options.backgroundRefresh : true;
    cacheOptions.maxAgeSeconds = options.maxAgeSeconds || 60 * 10;
    cacheOptions.individualMaxAgeSeconds = options.individualMaxAgeSeconds;
    delete options.backgroundRefresh;
    delete options.maxAgeSeconds;
    delete options.individualMaxAgeSeconds;
    return this.github.crossOrganization.repoTeams(
      this as Operations,
      this.organizationNamesWithAuthorizationHeaders,
      options,
      cacheOptions
    );
  }

  async getCrossOrganizationTeams(options?: any): Promise<CrossOrganizationMembersResult> {
    options = options || {};
    if (!options.maxAgeSeconds) {
      options.maxAgeSeconds = this.defaults.crossOrgsMembersStaleSecondsPerOrg;
    }
    if (options.backgroundRefresh === undefined) {
      options.backgroundRefresh = true;
    }
    const cacheOptions = {
      maxAgeSeconds: options.maxAgeSeconds,
      backgroundRefresh: options.backgroundRefresh,
    };
    delete options.maxAgeSeconds;
    delete options.backgroundRefresh;
    (options as any).doNotProjectEntities = true;
    const values = await this.github.crossOrganization.teams(
      this as Operations,
      this.organizationNamesWithAuthorizationHeaders,
      options,
      cacheOptions
    );
    const results = crossOrganizationResults(this, values, 'id');
    return results;
  }

  async getMembers(options?: ICacheOptions): Promise<CrossOrganizationMembersResult> {
    options = options || {};
    if (!options.maxAgeSeconds) {
      options.maxAgeSeconds = this.defaults.crossOrgsMembersStaleSecondsPerOrg;
    }
    if (options.backgroundRefresh === undefined) {
      options.backgroundRefresh = true;
    }
    const cacheOptions = {
      maxAgeSeconds: options.maxAgeSeconds,
      backgroundRefresh: options.backgroundRefresh,
    };
    delete options.maxAgeSeconds;
    delete options.backgroundRefresh;
    (options as any).doNotProjectEntities = true;
    const values = await this.github.crossOrganization.orgMembers(
      this as Operations,
      this.organizationNamesWithAuthorizationHeaders,
      options,
      cacheOptions
    );
    const crossOrgReturn = crossOrganizationResults(
      this,
      values,
      'id'
    ) as any as CrossOrganizationMembersResult;
    return crossOrgReturn;
  }

  getTeamByIdWithOrganization(id: number, organizationName: string, entity?: any): Team {
    const organization = this.getOrganization(organizationName);
    return organization.team(id, entity);
  }

  getOrganizationFromUrl(url: string): Organization {
    const asUrl = new URL(url);
    const paths = asUrl.pathname.split('/').filter((real) => real);
    if (paths[0] !== 'repos') {
      throw CreateError.InvalidParameters(`At this time, the first path segment must be "repos": ${url}`);
    }
    const orgName = paths[1];
    return this.getOrganization(orgName);
  }

  getRepositoryWithOrganizationFromUrl(url: string): Repository {
    const asUrl = new URL(url);
    const paths = asUrl.pathname.split('/').filter((real) => real);
    if (paths[0] !== 'repos') {
      throw CreateError.InvalidParameters(`At this time, the first path segment must be "repos": ${url}`);
    }
    const orgName = paths[1];
    const repoName = paths[2];
    return this.getRepositoryWithOrganization(repoName, orgName);
  }

  getRepositoryWithOrganization(repositoryName: string, organizationName: string, entity?: any): Repository {
    const organization = this.getOrganization(organizationName);
    return organization.repository(repositoryName, entity);
  }

  private async sendMail(mail: IMail): Promise<any> {
    const mailProvider = this.providers.mailProvider;
    const insights = this.providers.insights;
    const customData = {
      receipt: null,
      eventName: undefined,
    };
    try {
      const mailResult = await mailProvider.sendMail(mail);
      customData.receipt = mailResult;
      insights.trackEvent({ name: 'MailSuccess', properties: customData });
      return mailResult;
    } catch (mailError) {
      customData.eventName = 'MailFailure';
      insights.trackException({ exception: mailError, properties: customData });
      throw mailError;
    }
  }

  async emailTestRender(viewName: string, contentOptions: Record<string, any>): Promise<void> {
    const { insights } = this.providers;
    await renderHtmlMail(
      insights,
      viewName,
      contentOptions,
      this.config,
      /* is test only, no telemetry */ true
    );
  }

  async emailRenderSend(
    emailViewName: string,
    mail: IMail,
    contentOptions: Record<string, any>,
    extraOptions?: unknown
  ): Promise<any> {
    const companySpecific = getCompanySpecificDeployment();
    if (companySpecific?.features?.mailProvider?.combinedRenderSendMail) {
      const receipt = await companySpecific.features.mailProvider.combinedRenderSendMail(
        this.providers,
        emailViewName,
        mail,
        contentOptions,
        extraOptions
      );
      // If the company-specific provider is not able to handle the message, it will return no receipt.
      if (receipt) {
        return receipt;
      }
    }
    const { insights } = this.providers;
    try {
      const html = await renderHtmlMail(
        insights,
        emailViewName,
        contentOptions,
        this.config,
        /* live telemetry, not a test */ false
      );
      mail.content = html;
      const receipt = await this.sendMail(mail);
      return receipt;
    } catch (renderError) {
      console.warn('Error rendering email:', renderError);
      throw renderError;
    }
  }
}

async function getPromisedLinks(linkProvider: ILinkProvider): Promise<IPromisedLinks> {
  // TODO: consider looking at the options as to how to include/exclude properties etc.
  // today (TypeScript update with PGSQL) the 'options' have zero impact on what is actually returned...
  const links = await linkProvider.getAll();
  const jsonLinks = linkProvider.dehydrateLinks(links);
  const dataObject: IPromisedLinks = {
    headers: {
      type: 'links',
    },
    data: jsonLinks,
  };
  return dataObject;
}

interface IFireEventResult {
  url: string;
  value: string;
  body: string;
  headers: any;
  statusCode: any;
}

async function fireEvent(
  config: SiteConfiguration,
  configurationName: string,
  value: LinkEvent | UnlinkEvent
): Promise<IFireEventResult[]> {
  if (!config?.github?.links?.events) {
    return;
  }
  const userAgent = config.userAgent || 'Unknown user agent';
  const httpUrls = config.github.links.events.http;
  if (!httpUrls || !httpUrls[configurationName]) {
    return;
  }
  const urlOrUrls = httpUrls[configurationName];
  const urls = Array.isArray(urlOrUrls) ? urlOrUrls : [urlOrUrls];
  const results: IFireEventResult[] = [];
  for (const httpUrl of urls) {
    try {
      const response = await axios({
        method: 'POST',
        url: httpUrl,
        data: value,
        headers: {
          'User-Agent': userAgent,
          'X-Repos-Event': configurationName,
        },
      });
      results.push({
        url: httpUrl,
        value: JSON.stringify(value),
        headers: response.headers,
        body: response.data as any, // axios returns unknown now
        statusCode: response.status,
      });
    } catch (ignoredTechnicalError) {
      /* ignored */
      // TODO: telemetry
      console.warn(ignoredTechnicalError);
      console.log();
    }
  }
  return results;
}

function crossOrganizationResults(operations: Operations, results, keyProperty) {
  keyProperty = keyProperty || 'id';
  const map: IMapPlusMetaCost = new Map();
  operations.translateOrganizationNamesFromLowercase(results.orgs);
  for (const orgName of Object.getOwnPropertyNames(results.orgs)) {
    const orgValues = results.orgs[orgName];
    for (let i = 0; i < orgValues.length; i++) {
      const val = orgValues[i];
      const key = val[keyProperty];
      if (!key) {
        throw new Error(`Entity missing property ${key} during consolidation processing.`);
      }
      let mapEntry = map.get(key);
      if (!mapEntry) {
        mapEntry = {
          orgs: {},
        };
        mapEntry[keyProperty] = key;
        map.set(key, mapEntry);
      }
      mapEntry.orgs[orgName] = val;
    }
  }
  map.headers = results.headers;
  map.cost = results.cost;
  return map;
}

function restartAfterDynamicConfigurationUpdate(
  minimumSeconds: number,
  maximumSeconds: number,
  appInitialized: Date,
  organizationSettingsProvider: OrganizationSettingProvider
) {
  didDynamicConfigurationUpdate(appInitialized, organizationSettingsProvider)
    .then((changed) => {
      if (changed) {
        const randomSeconds = Math.floor(
          Math.random() * (maximumSeconds - minimumSeconds + 1) + minimumSeconds
        );
        console.log(
          `changes to dynamic configuration detected since ${appInitialized}, restarting in ${randomSeconds}s`
        );
        setInterval(() => {
          console.log(
            `shutting down process due to dynamic configuration changes being detected at least ${randomSeconds} seconds ago...`
          );
          return process.exit(0);
        }, randomSeconds * 1000);
        if (DynamicRestartCheckHandle) {
          clearInterval(DynamicRestartCheckHandle);
        }
      }
    })
    .catch((error) => {
      console.dir(error);
    });
}

async function didDynamicConfigurationUpdate(
  appInitialized: Date,
  organizationSettingsProvider: OrganizationSettingProvider
): Promise<boolean> {
  try {
    const allOrganizations = await organizationSettingsProvider.queryAllOrganizations();
    const activeOrganizations = allOrganizations.filter((org) => org.active);
    for (const organization of activeOrganizations) {
      if (organization.updated > appInitialized) {
        console.log(
          `organization ${organization.organizationName} was updated ${organization.updated} vs app started time of ${appInitialized}`
        );
        return true;
      }
    }
  } catch (updateOrganizationsError) {
    console.dir(updateOrganizationsError);
  }
  return false;
}
