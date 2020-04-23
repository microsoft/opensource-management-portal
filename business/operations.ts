//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

/*eslint no-console: ["error", { allow: ["warn"] }] */

import rp from 'request-promise-native';
import throat from 'throat';

import { ICacheOptions, IMapPlusMetaCost, IProviders, IPagedCrossOrganizationCacheOptions, IGetAuthorizationHeader, IPurposefulGetAuthorizationHeader, IAuthorizationHeaderValue, IDictionary, CreateError, ErrorHelper, setImmediateAsync } from '../transitional';

import { Account } from './account';
import { GraphManager } from './graphManager';
import { Organization } from './organization';
import GitHubApplication from './application';
import { GitHubTokenManager } from '../github/tokenManager';

import RenderHtmlMail from '../lib/emailRender';

import { wrapError, sortByCaseInsensitive, asNumber } from '../utils';
import { ICorporateLink } from './corporateLink';
import { Repository } from './repository';
import { RestLibrary } from '../lib/github';
import { IMailAddressProvider, GetAddressFromUpnAsync } from '../lib/mailAddressProvider';
import { Team, ICrossOrganizationTeamMembership } from './team';
import { AppPurpose, GitHubAppAuthenticationType } from '../github';
import { OrganizationSetting } from '../entities/organizationSettings/organizationSetting';
import { OrganizationSettingProvider } from '../entities/organizationSettings/organizationSettingProvider';
import { IMail } from '../lib/mailProvider';
import { ILinkProvider } from '../lib/linkProviders';
import { getUserAndManagerById, IGraphEntryWithManager } from '../lib/graphProvider';
import { ICacheHelper } from '../lib/caching';

const throwIfOrganizationIdsMissing = true;

const SecondsBetweenOrganizationSettingUpdatesCheck = 60 * 2; // every 2 minutes, check for dynamic app updates
let DynamicRestartCheckHandle = null;

const ParallelLinkLookup = 4;

interface ICacheDefaultTimes {
  orgReposStaleSeconds: number;
  orgRepoTeamsStaleSeconds: number;
  orgRepoCollaboratorsStaleSeconds: number;
  orgRepoCollaboratorStaleSeconds: number;
  orgRepoDetailsStaleSeconds: number;
  orgTeamsStaleSeconds: number;
  orgTeamDetailsStaleSeconds: number;
  orgTeamsSlugLookupStaleSeconds: number;
  orgMembersStaleSeconds: number;
  teamMaintainersStaleSeconds: number;
  orgMembershipStaleSeconds: number;
  orgMembershipDirectStaleSeconds: number;
  crossOrgsReposStaleSecondsPerOrg: number;
  crossOrgsReposParallelCalls: number;
  crossOrgsMembersStaleSecondsPerOrg: number;
  crossOrgsMembersParallelCalls: number;
  corporateLinksStaleSeconds: number;
  repoBranchesStaleSeconds: number;
  accountDetailStaleSeconds: number;
  teamDetailStaleSeconds: number;
  orgRepoWebhooksStaleSeconds: number;
  teamRepositoryPermissionStaleSeconds: number;
}

// defaults could move to configuration alternatively
const defaults: ICacheDefaultTimes = {
  orgReposStaleSeconds: 60 * 15 /* 15m */,
  orgRepoTeamsStaleSeconds: 60 * 3 /* 3m */,
  orgRepoCollaboratorsStaleSeconds: 60 * 30 /* 30m */,
  orgRepoCollaboratorStaleSeconds: 30 /* half minute */,
  orgRepoDetailsStaleSeconds: 60 * 5 /* 5m */,
  orgTeamsStaleSeconds: 60 * 5 /* 5m */,
  orgTeamDetailsStaleSeconds: 60 * 30 /* 30m */,
  orgTeamsSlugLookupStaleSeconds: 30 /* half a minute */,
  orgMembersStaleSeconds: 60 * 30 /* 30m */,
  teamMaintainersStaleSeconds: 60 * 2 /* 2m */,
  orgMembershipStaleSeconds: 60 * 5 /* 5m */,
  orgMembershipDirectStaleSeconds: 30 /* 30s */,
  crossOrgsReposStaleSecondsPerOrg: 60 * 60 * 2 /* 2 hours per org */,
  crossOrgsReposParallelCalls: 3,
  crossOrgsMembersStaleSecondsPerOrg: 60 * 60 * 2 /* 2 hours per org */,
  crossOrgsMembersParallelCalls: 5,
  corporateLinksStaleSeconds: 30 /* 30s (used to be 5m) */,
  repoBranchesStaleSeconds: 60 * 5 /* 5m */,
  accountDetailStaleSeconds: 60 * 60 * 24 /* 24h */,
  teamDetailStaleSeconds: 60 * 60 * 2 /* 2h */,
  orgRepoWebhooksStaleSeconds: 60 * 60 * 8 /* 8h */,
  teamRepositoryPermissionStaleSeconds: 0 /* 0m */,
};

export const RedisPrefixManagerInfoCache = 'employeewithmanager:';

const defaultGitHubPageSize = 100;

export enum SupportedLinkType {
  User = 'user',
  ServiceAccount = 'serviceAccount',
}

export interface ISupportedLinkTypeOutcome {
  type: SupportedLinkType;
  graphEntry: IGraphEntryWithManager;
}

export enum UnlinkPurpose {
  Unknown = 'unknown',
  Termination = 'termination', // no longer listed as an employee
  Self = 'self', // the user self-service unlink themselves
  Operations = 'operations', // operational support
  Deleted = 'deleted', // the GitHub account has been deleted or does not exist
};

export enum LinkOperationSource {
  Portal = 'portal',
  Api = 'api',
}

export interface ICreateLinkOptions {
  link: ICorporateLink;
  operationSource: LinkOperationSource;
  skipCorporateValidation?: boolean;
  skipGitHubValidation?: boolean;
  skipSendingMail?: boolean;
  eventProperties?: IDictionary<string>;
  correlationId?: string;
}

export interface ICreatedLinkOutcome {
  linkId: string;
  resourceLink?: string;
}

export interface ICrossOrganizationMembershipBasics {
  id: string;
  login: string;
  avatar_url: string;
}

export interface ICrossOrganizationMembershipByOrganization {
  id: number; // ?
  orgs: any; // object[orgName] = theirGitHubaccount entity avatar_url, id, login : ICrossOrganizationMembershipBasics
}

interface IPromisedLinks {
  headers: {
    type: 'links',
  },
  data: ICorporateLink[],
}

export interface ICrossOrganizationMembersResult extends Map<number, ICrossOrganizationMembershipByOrganization> {}

export interface ICachedEmployeeInformation {
  id: string;
  displayName: string;
  userPrincipalName: string;
  managerId: string;
  managerDisplayName: string;
  managerMail: string;
}

export class Operations {
  private _cache: ICacheHelper;
  private _providers: IProviders;
  private _baseUrl: string;
  private _linkProvider: ILinkProvider;
  private _mailAddressProvider: IMailAddressProvider;
  private _mailProvider: any;
  private _graphManager: GraphManager;
  private _github: RestLibrary;
  private _config: any;
  private _insights: any;
  private _defaults: ICacheDefaultTimes;
  private _organizationNames: string[];
  private _organizations: Map<string, Organization>;
  private _uncontrolledOrganizations: Map<string, Organization>;
  private _organizationOriginalNames: any;
  private _organizationNamesWithWithAuthorizationHeaders: any;
  private _defaultPageSize: number;
  private _tokenManager: GitHubTokenManager;
  private _organizationIds: Map<number, Organization>;
  private _applicationIds: Map<number, GitHubApplication>;
  private _initialized: Date;
  private _dynamicOrganizationSettings: OrganizationSetting[];
  private _dynamicOrganizationIds: Set<number>;

  get initialized(): Date {
    return this._initialized;
  }

  get providers(): IProviders {
    return this._providers;
  }

  get baseUrl(): string {
    return this._baseUrl;
  }

  get absoluteBaseUrl(): string {
    let baseUrl = this.config && this.config.webServer && this.config.webServer.baseUrl ? this.config.webServer.baseUrl : null;
    if (baseUrl) {
      return baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
    }
    return '/';
  }

  get mailAddressProvider(): IMailAddressProvider {
    return this._mailAddressProvider;
  }

  get linkProvider(): ILinkProvider {
    return this._linkProvider;
  }

  get mailProvider(): any {
    return this._mailProvider;
  }

  get graphManager(): GraphManager {
    return this._graphManager;
  }

  get github(): RestLibrary  {
    return this._github;
  }

  get defaults(): ICacheDefaultTimes {
    return this._defaults;
  }

  get config(): any {
    return this._config;
  }

  get insights(): any {
    return this._insights;
  }

  get defaultPageSize(): number {
    return this._defaultPageSize;
  }

  constructor(options) {
    if (!options.github) {
      throw new Error('options.github required');
    }
    this._github = options.github;
    if (!options.config) {
      throw new Error('options.config required');
    }
    this._config = options.config;
    if (!options.insights) {
      throw new Error('options.insights required');
    }
    this._insights = options.insights;
    if (!options.cacheProvider) {
      throw new Error('options.cacheProvider required');
    }
    this._cache = options.cacheProvider;

    this._providers = options;
    this._baseUrl = '/';
    this._defaults = Object.assign({}, defaults);
    this._applicationIds = new Map();
    this._mailAddressProvider = options.mailAddressProvider;
    this._mailProvider = options.mailProvider;
    this._linkProvider = options.linkProvider as ILinkProvider;
    this._graphManager = new GraphManager(this);
    this._uncontrolledOrganizations = new Map();
    this._defaultPageSize = this.config && this.config.github && this.config.github.api && this.config.github.api.defaultPageSize ? this.config.github.api.defaultPageSize : defaultGitHubPageSize;
    const hasModernGitHubApps = options.config.github && options.config.github.app;
    this._tokenManager = new GitHubTokenManager({
      customerFacingApp: hasModernGitHubApps ? options.config.github.app.ui : null,
      operationsApp: hasModernGitHubApps? options.config.github.app.operations : null,
      dataApp: hasModernGitHubApps? options.config.github.app.data : null,
      backgroundJobs: hasModernGitHubApps ? options.config.github.app.jobs : null,
      app: this.providers.app,
    });
    this._dynamicOrganizationIds = new Set();
    this._dynamicOrganizationSettings = [];
  }

  async initialize(): Promise<Operations> {
    await this._tokenManager.initialize();
    const hasModernGitHubApps = this.config.github && this.config.github.app;
    // const hasConfiguredOrganizations = this.config.github.organizations && this.config.github.organizations.length;
    const organizationSettingsProvider = this.providers.organizationSettingsProvider;
    if (hasModernGitHubApps && organizationSettingsProvider) {
      const dynamicOrganizations = (await organizationSettingsProvider.queryAllOrganizations()).filter(dynamicOrg => dynamicOrg.active === true);
      this._dynamicOrganizationSettings = dynamicOrganizations;
      this._dynamicOrganizationIds = new Set(dynamicOrganizations.map(org => asNumber(org.organizationId)));
    }
    this._tokenManager.getAppIds().map(appId => {
      const { friendlyName } = this._tokenManager.getAppById(appId);
      const slug = this._tokenManager.getSlugById(appId);
      const app = new GitHubApplication(this, appId, slug, friendlyName, this.getAppAuthorizationHeader.bind(this, this._tokenManager, appId));
      this._applicationIds.set(appId, app);
    });
    this._initialized = new Date();
    if (this._dynamicOrganizationSettings && organizationSettingsProvider) {
      DynamicRestartCheckHandle = setInterval(restartAfterDynamicConfigurationUpdate.bind(null, 10, 120, this._initialized, organizationSettingsProvider), 1000 * SecondsBetweenOrganizationSettingUpdatesCheck);
    }
    if (throwIfOrganizationIdsMissing) {
      this.getOrganizationIds();
    }
    return this;
  }

  getApplicationById(appId: number): GitHubApplication {
    return this._applicationIds.get(appId);
  }

  getApplications(): GitHubApplication[] {
    return Array.from(this._applicationIds.values());
  }

  get   organizationNames(): string[] {
    if (!this._organizationNames) {
      const names = [];
      const processed = new Set<string>();
      for (const dynamic of this._dynamicOrganizationSettings) {
        const lowercase = dynamic.organizationName.toLowerCase();
        processed.add(lowercase);
        names.push(lowercase);
      }
      for (let i = 0; i < this._config.github.organizations.length; i++) {
        const lowercase = this._config.github.organizations[i].name.toLowerCase();
        if (!processed.has(lowercase)) {
          names.push(lowercase);
          processed.add(lowercase);
        }
      }
      this._organizationNames = names.sort(sortByCaseInsensitive);
    }
    return this._organizationNames;
  }

  getOrganizationIds(): number[] {
    if (!this._organizationIds) {
      const organizations = this.organizations;
      this._organizationIds = new Map();
      this._dynamicOrganizationSettings.map(entry => {
        if (entry.active) {
          const org = this.getOrganization(entry.organizationName.toLowerCase());
          this._organizationIds.set(asNumber(entry.organizationId), org);
        }
      });
      // This check only runs on _static_ configuration entries, since adopted
      // GitHub App organizations must always have an organization ID.
      for (let i = 0; i < this._config.github.organizations.length; i++) {
        const organizationConfiguration = this._config.github.organizations[i];
        const organization = organizations.get(organizationConfiguration.name.toLowerCase());
        if (!organization) {
          throw new Error(`Missing organization configuration ${organizationConfiguration.name}`);
        }
        if (!organizationConfiguration.id) {
          if (throwIfOrganizationIdsMissing) {
            throw new Error(`Organization ${organization.name} is not configured with an 'id' which can lead to issues if the organization is renamed. throwIfOrganizationIdsMissing is true: id is required`);
          } else {
            console.warn(`Organization ${organization.name} is not configured with an 'id' which can lead to issues if the organization is renamed.`);
          }
        } else if (!this._organizationIds.has(organizationConfiguration.id)) {
          this._organizationIds.set(organizationConfiguration.id, organization);
        }
      }
    }
    return Array.from(this._organizationIds.keys());
  }

  private createOrganization(name: string, settings: OrganizationSetting, centralOperationsFallbackToken: string, appAuthenticationType: GitHubAppAuthenticationType): Organization {
    name = name.toLowerCase();
    let ownerToken = null;
    if (!settings) {
      let staticSettings = null;
      const group = this.config.github.organizations;
      for (let i = 0; i < group.length; i++) {
        if (group[i].name && group[i].name.toLowerCase() === name) {
          const staticOrganizationSettings = group[i];
          if (staticOrganizationSettings.ownerToken) {
            ownerToken = staticOrganizationSettings.ownerToken;
          }
          staticSettings = staticOrganizationSettings;
          break;
        }
      }
      try {
        settings = OrganizationSetting.CreateFromStaticSettings(staticSettings);
        settings.active = true;
      } catch (translateStaticSettingsError) {
        throw new Error(`This application is not able to translate the static configuration for the ${name} organization. Specific error: ${translateStaticSettingsError.message}`);
      }
    }
    if (!settings) {
      throw new Error(`This application is not configured for the ${name} organization`);
    }
    const hasDynamicSettings = this._dynamicOrganizationIds && settings.organizationId && this._dynamicOrganizationIds.has(asNumber(settings.organizationId));
    return new Organization(this, name, settings, this.getAuthorizationHeader.bind(this, name, settings, ownerToken, centralOperationsFallbackToken, appAuthenticationType), hasDynamicSettings);
  }

  private async getAppAuthorizationHeader(tokenManager: GitHubTokenManager, appId: number): Promise<string> {
    const jwt = tokenManager.getAppById(appId).getSignedJsonWebToken();
    const value = `bearer ${jwt}`;
    return value;
  }

  private async getAuthorizationHeader(
    organizationName: string,
    organizationSettings: OrganizationSetting,
    legacyOwnerToken: string,
    centralOperationsFallbackToken: string,
    appAuthenticationType: GitHubAppAuthenticationType,
    purpose: AppPurpose): Promise<IAuthorizationHeaderValue> {
    if (!this._tokenManager.organizationSupportsAnyPurpose(organizationName, organizationSettings)) {
      const legacyTokenValue = legacyOwnerToken || centralOperationsFallbackToken;
      if (!legacyTokenValue) {
        throw new Error(`Organization ${organizationName} is not configured with a GitHub app, Personal Access Token ownerToken configuration value, or a fallback central operations token`);
      }
      return { value: `token ${legacyTokenValue}`, purpose: null, source: legacyOwnerToken ? 'legacyOwnerToken' : 'centralOperationsFallbackToken' };
    }
    if (!purpose) {
      purpose = AppPurpose.Data;
      console.log(`TODO: consider investigating the callback here as to why the getAuthorizationHeader call was not provided a purpose for the ${organizationName} org. falling back to: purpose=${purpose}`);
    }
    return this._tokenManager.getOrganizationAuthorizationHeader(organizationName, purpose, organizationSettings, appAuthenticationType);
  }

  get organizations() {
    if (!this._organizations) {
      const organizations = new Map<string, Organization>();
      const names = this.organizationNames;
      const centralOperationsToken = this.config.github.operations.centralOperationsToken;
      for (let i = 0; i < names.length; i++) {
        const name = names[i];
        let dynamicSettings: OrganizationSetting = null;
        this._dynamicOrganizationSettings.map(dos => {
          if (dos.active && dos.organizationName.toLowerCase() === name.toLowerCase()) {
            dynamicSettings = dos;
          }
        });
        const organization = this.createOrganization(name, dynamicSettings, centralOperationsToken, GitHubAppAuthenticationType.BestAvailable);
        organizations.set(name, organization);
      }
      this._organizations = organizations;
    }
    return this._organizations;
  }

  // get legalEntities(): string[] {
  //   const config = this._config;
  //   if (config.legalEntities && config.legalEntities.entities) {
  //     return config.legalEntities.entities;
  //   }
  // }

  private getAlternateOrganization(name: string, alternativeType) {
    // An 'alternate' organization is one whose static settings come from a
    // different location within the github.organizations config file.
    const lowercase = name.toLowerCase();
    const list = this.config.github.organizations[alternativeType];
    if (list) {
      for (let i = 0; i < list.length; i++) {
        const settings = list[i];
        if (settings && settings.name && settings.name.toLowerCase() === lowercase) {
          const centralOperationsToken = this.config.github.operations.centralOperationsToken;
          return this.createOrganization(lowercase, settings, centralOperationsToken, GitHubAppAuthenticationType.BestAvailable);
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
    return this.createOrganization(settings.organizationName.toLowerCase(), settings, null, GitHubAppAuthenticationType.ForceSpecificInstallation);
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
    const centralOperationsToken = this.config.github.operations.centralOperationsToken;
    const org = this.createOrganization(organizationName, emptySettings, centralOperationsToken, GitHubAppAuthenticationType.ForceSpecificInstallation);
    this._uncontrolledOrganizations.set(organizationName, org);
    org.uncontrolled = true;
    return org;
  }

  isIgnoredOrganization(name: string): boolean {
    const value = this.getAlternateOrganization(name, 'onboarding') || this.getAlternateOrganization(name, 'ignore');
    return !!value;
  }

  getOrganizations(organizationList?: string[]): Organization[] {
    if (!organizationList) {
      return Array.from(this.organizations.values());
    }
    const references = [];
    organizationList.forEach(orgName => {
      const organization = this.getOrganization(orgName);
      references.push(organization);
    });
    return references;
  }

  getPrimaryOrganizationName(): string {
    const id = this.config.github && this.config.github.operations && this.config.github.operations.primaryOrganizationId ? this.config.github.operations.primaryOrganizationId : null;
    if (id) {
      return this.getOrganizationById(asNumber(id)).name;
    }
    return this.getOrganizationOriginalNames()[0];
  }

  getOrganizationOriginalNames(): string[] {
    if (!this._organizationOriginalNames) {
      const names: string[] = [];
      const visited = new Set<string>();
      for (const entry of this._dynamicOrganizationSettings) {
        if (entry.active) {
          names.push(entry.organizationName);
          const lowercase = entry.organizationName.toLowerCase();
          visited.add(lowercase);
        }
      }
      for (let i = 0; i < this._config.github.organizations.length; i++) {
        const original = this._config.github.organizations[i].name;
        const lowercase = original.toLowerCase();
        if (!visited.has(lowercase)) {
          names.push(original);
          visited.add(lowercase);
        }
      }
      this._organizationOriginalNames = names.sort(sortByCaseInsensitive);
    }
    return this._organizationOriginalNames;
  }

  translateOrganizationNamesFromLowercase(object) {
    const orgs = this.getOrganizationOriginalNames();
    orgs.forEach(name => {
      const lc = name.toLowerCase();
      if (name !== lc && object[lc] !== undefined) {
        object[name] = object[lc];
        delete object[lc];
      }
    });
    return object;
  }

  get organizationNamesWithWithAuthorizationHeaders() {
    if (!this._organizationNamesWithWithAuthorizationHeaders) {
      const tokens = {};
      const visited = new Set<string>();
      for (const entry of this._dynamicOrganizationSettings) {
        const lowercase = entry.organizationName.toLowerCase();
        if (entry.active && !visited.has(lowercase)) {
          visited.add(lowercase);
          const orgInstance = this.getOrganization(lowercase);
          const token = orgInstance.getAuthorizationHeader();
          tokens[lowercase] = token;
        }
      }
      for (let i = 0; i < this._config.github.organizations.length; i++) {
        const name = this._config.github.organizations[i].name.toLowerCase();
        if (visited.has(name)) {
          continue;
        }
        visited.add(name);
        const orgInstance = this.getOrganization(name);
        const token = orgInstance.getAuthorizationHeader();
        tokens[name] = token;
      }
      this._organizationNamesWithWithAuthorizationHeaders = tokens;
    }
    return this._organizationNamesWithWithAuthorizationHeaders;
  }

  async getCachedEmployeeManagementInformation(corporateId: string): Promise<ICachedEmployeeInformation> {
    const key = `${RedisPrefixManagerInfoCache}${corporateId}`;
    const currentManagerIfAny = await this._cache.getObjectCompressed(key);
    return currentManagerIfAny as ICachedEmployeeInformation;
  }

  async linkAccounts(options: ICreateLinkOptions): Promise<ICreatedLinkOutcome> {
    const { linkProvider, graphProvider, insights } = this.providers;
    if (!linkProvider) {
      throw CreateError.ServerError('linkProvider required');
    }
    if (!graphProvider) {
      throw CreateError.ServerError('Graph provider required');
    }
    if (!options.link) {
      throw CreateError.InvalidParameters('options.link required');
    }
    const link = options.link;
    if (!options.operationSource || (options.operationSource !== LinkOperationSource.Api && options.operationSource !== LinkOperationSource.Portal)) {
      throw CreateError.InvalidParameters('options.operationSource missing or invalid');
    }
    if (!link.corporateId) {
      throw CreateError.InvalidParameters('options.link.corporateId required');
    }
    if (!link.thirdPartyId) {
      throw CreateError.InvalidParameters('options.link.thirdPartyId required');
    }
    const correlationId = options.correlationId || 'no-correlation-id';
    const insightsOperationsPrefix = options.operationSource === LinkOperationSource.Portal ? 'Portal' : 'Api';
    const insightsLinkType = link.isServiceAccount ? 'ServiceAccount' : 'User';
    const insightsPrefix = `${insightsOperationsPrefix}${insightsLinkType}Link`;
    const insightsLinkedMetricName = `${insightsPrefix}s`;
    const insightsAllUpMetricsName = `${insightsLinkType}Links`;

    insights.trackEvent({ name: `${insightsPrefix}Start`, properties: {...link, correlationId} });

    if (!options.skipGitHubValidation) {
      const githubAccount = this.getAccount(link.thirdPartyId);
      try {
        await githubAccount.getDetails();
        link.thirdPartyUsername = githubAccount.login;
        link.thirdPartyAvatar = githubAccount.avatar_url;
      } catch (validateAccountError) {
        throw ErrorHelper.EnsureHasStatus(validateAccountError, 400);
      }
    }

    let mailAddress: string = null;
    if (!options.skipCorporateValidation) {
      try {
        const corporateInfo = await this.validateCorporateAccountCanLink(link.corporateId);
        const corporateAccount = corporateInfo.graphEntry;
        if (!corporateAccount) {
          throw CreateError.NotFound(`Corporate ID ${link.corporateId} not found`);
        }
        mailAddress = corporateAccount.mail || link.serviceAccountMail;
        link.corporateDisplayName = corporateAccount.displayName;
        link.corporateUsername = corporateAccount.userPrincipalName;
        // Validate that the corporate account can be linked
        if (corporateInfo.type === SupportedLinkType.ServiceAccount) {
          if (!link.serviceAccountMail) {
            throw CreateError.InvalidParameters(`Corporate account ${link.corporateUsername} must provide a Service Account e-mail address`);
          }
          link.isServiceAccount = true;
        }
      } catch (validateCorporateError) {
        throw ErrorHelper.EnsureHasStatus(validateCorporateError, 400);
      }
    }

    let newLinkId: string = null;
    try {
      newLinkId = await linkProvider.createLink(link);
      const eventData = {...link, linkId: newLinkId, correlationId };
      insights.trackEvent({ name: `${insightsPrefix}Created`, properties: eventData });
      insights.trackMetric({ name: insightsLinkedMetricName, value: 1 });
      insights.trackMetric({ name: insightsAllUpMetricsName, value: 1 });
      setImmediateAsync(this.fireLinkEvent.bind(this, eventData));
    } catch (createLinkError) {
      if (ErrorHelper.IsConflict(createLinkError)) {
        insights.trackEvent({ name: `${insightsPrefix}AlreadyLinked`, properties: {...link, correlationId}})
        throw ErrorHelper.EnsureHasStatus(createLinkError, 409);
      }
      insights.trackException({
        exception: createLinkError,
        properties: {...link, event: `${insightsPrefix}InsertError`, correlationId},
      });
      throw createLinkError;
    }

    if (!options.skipSendingMail) {
      setImmediateAsync(this.sendLinkedAccountMail.bind(this, link, mailAddress, correlationId, false /* do not throw on errors */));
    }

    const getApi = `${this.baseUrl}api/people/links/${newLinkId}`;
    insights.trackEvent({ name: `${insightsPrefix}End`, properties: { newLinkId, getApi } });
    return { linkId: newLinkId, resourceLink: getApi };
  }

  async validateCorporateAccountCanLink(corporateId: string): Promise<ISupportedLinkTypeOutcome> {
    const graphEntry = await getUserAndManagerById(this.providers.graphProvider, corporateId);
    // NOTE: This assumption, that a user without a manager must be a Service Account,
    // is a bit of a hack. It means that the CEO will be flagged as a service account if
    // they find the time to use this app. This code prioritizes the more common scenario,
    // that a user without an assigned manager in the directory is a Service Account.
    if (graphEntry && !graphEntry.manager) {
      return { type: SupportedLinkType.ServiceAccount, graphEntry };
    }
    return { type: SupportedLinkType.User, graphEntry };
  }

  private async sendLinkedAccountMail(link: ICorporateLink, mailAddress: string | null, correlationId: string | null, throwIfError: boolean): Promise<void> {
    const { insights, mailProvider, mailAddressProvider, config } = this.providers;
    if (!mailProvider) {
      return;
    }
    if (!mailAddress && !mailAddressProvider) {
      return;
    }
    if (!mailAddress) {
      try {
        mailAddress = await GetAddressFromUpnAsync(mailAddressProvider, link.corporateUsername);
      } catch (getAddressError) {
        if (throwIfError) {
          throw getAddressError;
        }
        return;
      }
    }
    const to = [mailAddress];
    const toAsString = to.join(', ');
    const cc = [];
    if (config.brand && config.brand.operationsEmail && link.isServiceAccount) {
      cc.push(config.brand.operationsEmail);
    }
    const mail = {
      to,
      subject: `${link.corporateUsername} linked to ${link.thirdPartyUsername}`,
      correlationId,
      content: undefined,
    };
    const contentOptions = {
      reason: (`You are receiving this one-time e-mail because you have linked your account.
                To stop receiving these mails, you can unlink your account.
                This mail was sent to: ${toAsString}`),
      headline: `Welcome to GitHub, ${link.thirdPartyUsername}`,
      notification: 'information',
      app: `${config.brand.companyName} GitHub`,
      correlationId,
      docs: config && config.microsoftOpenSource ? config.microsoftOpenSource.docs : null,
      companyName: config.brand.companyName,
      link,
    };
    try {
      mail.content = await this.emailRender('link', contentOptions);
    } catch (renderError) {
      insights.trackException({
        exception: renderError,
        properties: {
          content: contentOptions,
          eventName: 'LinkMailRenderFailure',
        },
      });
      if (throwIfError) {
        throw renderError;
      }
      return;
    }
    const customData = {
      content: contentOptions,
      receipt: null,
      eventName: undefined,
    };
    try {
      const receipt = await this.sendMail(mail);
      insights.trackEvent({ name: 'LinkMailSuccess', properties: customData });
      customData.receipt = receipt;
    } catch (sendMailError) {
      customData.eventName = 'LinkMailFailure';
      insights.trackException({ exception: sendMailError, properties: customData });
      if (throwIfError) {
        throw sendMailError;
      }
      return;
    }
  }

  async terminateLinkAndMemberships(thirdPartyId, options?: any): Promise<string[]> {
    const insights = this.insights;

    options = options || {};
    let history: string[] = [];
    const continueOnError = options.continueOnError || false;
    let errors = 0;

    const account: Account = this.getAccount(thirdPartyId);
    const reason = options.reason || 'Automated processPendingUnlink operation';
    const purpose = options.purpose as UnlinkPurpose || UnlinkPurpose.Unknown;

    try {
      // Uses an ID-based lookup on GitHub in case the user was renamed.
      // Also retrieves the link into memory in the account instance.
      await account.getDetailsAndDirectLink();
    } catch (noDirectDetails) {
      ++errors;
      if (insights) {
        insights.trackException({ exception: noDirectDetails });
      }
      // not a fatal error in this method however
      history.push(noDirectDetails.toString());
    }

    if (insights) {
      insights.trackEvent({
        name: 'UserUnlinkStart',
        properties: {
          id: account.id,
          login: account.login,
          reason: reason,
          purpose,
          continueOnError: continueOnError ? 'continue on errors' : 'halt on errors',
        },
      });
    }

    // GitHub memberships
    try {
      const removal = await account.removeManagedOrganizationMemberships();
      history.push(... removal.history);
      if (removal.error) {
        throw removal.error; // unclear if this is actually ideal
      }
    } catch (removeOrganizationsError) {
      ++errors;
      // If a removal error occurs, do not remove the link and throw and error
      // so that the link data and information is still present until the issue
      // can be cleared
      if (insights) {
        insights.trackException({ exception: removeOrganizationsError });
      }
      if (!continueOnError) {
        throw removeOrganizationsError;
      }
      history.push(`Organization removal error: ${removeOrganizationsError.toString()}`);
    }

    // Link
    try {
      history.push(... await account.removeLink());
    } catch (removeLinkError) {
      ++errors;
      if (insights) {
        insights.trackException({ exception: removeLinkError });
      }
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

    // Collaborator permissions to repositories
    try {
      const removed = await account.removeCollaboratorPermissions();
      history.push(... removed.history);
      if (removed.error) {
        throw removed.error;
      }
    } catch (removeCollaboratorsError) {
      ++errors;
      if (insights) {
        insights.trackException({ exception: removeCollaboratorsError });
      }
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

    // Notify
    try {
      await this.sendTerminatedAccountMail(account, purpose, history, errors);
      history.push('Unlink e-mail sent to manager');
    } catch (notifyTerminationMailError) {
      if (insights) {
        insights.trackException({ exception: notifyTerminationMailError });
      }
      // Notification should never throw
      history.push('Unlink e-mail COULD NOT be sent to manager');
    }

    // Telemetry
    if (insights) {
      const historyAsString = JSON.stringify(history);
      insights.trackEvent({
        name: 'UserUnlink',
        properties: {
          id: account.id,
          login: account.login,
          reason: reason,
          purpose,
          continueOnError: continueOnError ? 'continue on errors' : 'halt on errors',
          history: historyAsString,
        },
      });
    }

    return history;
  }

  getOperationsMailAddress(): string {
    return this.config.brand.operationsMail;
  }

  getExtendedOperationsMailAddresses(): string[] {
    const extendedMailsValue = this.config.brand?.extendedOperationsMails;
    if (extendedMailsValue) {
      return extendedMailsValue.split(',');
    }
    return [this.getOperationsMailAddress()];
  }

  private async sendTerminatedAccountMail(account: Account, purpose: UnlinkPurpose, details: string[], errorsCount: number): Promise<void> {
    if (!this.providers.mailProvider || !account.link || !account.link.corporateId) {
      return;
    }

    purpose = purpose || UnlinkPurpose.Unknown;

    let errorMode = errorsCount > 0;

    let operationsMail = this.config.brand ? (this.config.brand.unlinkOperationsMail || this.config.brand.operationsMail) : null;
    if (!operationsMail && errorMode) {
      return;
    }
    let operationsArray = operationsMail.split(',');

    let cachedEmployeeManagementInfo: ICachedEmployeeInformation = null;
    let displayName = account.link.corporateDisplayName || account.link.corporateUsername || account.link.corporateId;
    let upn = account.link.corporateUsername || account.link.corporateId;
    try {
      cachedEmployeeManagementInfo = await this.getCachedEmployeeManagementInformation(account.link.corporateId);
      if (!cachedEmployeeManagementInfo || !cachedEmployeeManagementInfo.managerMail) {
        cachedEmployeeManagementInfo = {
          id: account.link.corporateId,
          displayName,
          userPrincipalName: upn,
          managerDisplayName: null,
          managerId: null,
          managerMail: null,
        };
        throw new Error(`No manager e-mail address or information retrieved from a previous cache for corporate user ID ${account.link.corporateId}`);
      }
      if (cachedEmployeeManagementInfo.displayName) {
        displayName = cachedEmployeeManagementInfo.displayName;
      }
      if (cachedEmployeeManagementInfo.userPrincipalName) {
        upn = cachedEmployeeManagementInfo.userPrincipalName;
      }
    } catch (getEmployeeInfoError) {
      errorMode = true;
      details.push(getEmployeeInfoError.toString());
    }

    const to: string[] = [];
    if (errorMode) {
      to.push(...operationsArray);
    } else {
      to.push(cachedEmployeeManagementInfo.managerMail);
    }
    const bcc = [];
    if (!errorMode) {
      bcc.push(...operationsArray);
    }
    const toAsString = to.join(', ');

    let subjectPrefix = '';
    let subjectSuffix = '';
    let headline = `${displayName} has been unlinked from GitHub`;
    switch (purpose) {
      case UnlinkPurpose.Self:
        headline = `${displayName} unlinked themselves from GitHub`;
        subjectPrefix = 'FYI: ';
        subjectSuffix = ' [self-service remove]';
        break;
      case UnlinkPurpose.Deleted:
        subjectPrefix = 'FYI: ';
        subjectSuffix = '[account deleted]';
        headline = `${displayName} deleted their GitHub account`;
        break;
      case UnlinkPurpose.Operations:
        subjectPrefix = 'FYI: ';
        subjectSuffix = ' [corporate GitHub operations]';
        break;
      case UnlinkPurpose.Termination:
        subjectPrefix = '[UNLINKED] ';
        headline = `${displayName} may not be an active employee`;
        break;
      case UnlinkPurpose.Unknown:
      default:
        subjectSuffix = ' [unknown]';
        break;
    }
    const mail = {
      to,
      bcc,
      subject: `${subjectPrefix}${upn || displayName} unlinked from GitHub ${subjectSuffix}`.trim(),
      category: ['link'],
      content: undefined,
    };
    mail.content = await this.emailRender('managerunlink', {
      reason: (`As a manager you receive one-time security-related messages regarding your direct reports who have linked their GitHub account to the company.
                This mail was sent to: ${toAsString}`),
      headline,
      notification: 'information',
      app: `${this.config.brand.companyName} GitHub`,
      link: account.link,
      managementInformation: cachedEmployeeManagementInfo,
      purpose,
      details,
    });

    await this.sendMail(mail);
  }

  getDefaultRepositoryTemplateNames(): string[] {
    if (this._config.github && this._config.github.templates && this._config.github.templates.defaultTemplates && this._config.github.templates.defaultTemplates.length > 0) {
      return this._config.github.templates.defaultTemplates as string[];
    }
    return null;
  }

  getDefaultLegalEntities(): string[] {
    if (this._config.legalEntities && this._config.legalEntities.defaultOrganizationEntities && this._config.legalEntities.defaultOrganizationEntities.length > 0) {
      return this._config.legalEntities.defaultOrganizationEntities as string[];
    }
    return null;
  }

  getOrganization(name: string): Organization {
    if (!name) {
      throw new Error('getOrganization: name required');
    }
    const lc = name.toLowerCase();
    const organization = this.organizations.get(lc);
    if (!organization) {
      throw new Error(`Could not find configuration for the "${name}" organization.`);
    }
    return organization;
  }

  getOrganizationById(organizationId: number): Organization {
    if (typeof(organizationId) === 'string') {
      organizationId = parseInt(organizationId, 10);
      console.warn(`getOrganizationById: organizationId must be a number`);
    }
    if (!this._organizationIds) {
      this.getOrganizationIds();
    }
    const org = this._organizationIds.get(organizationId);
    if (!org) {
      throw new Error(`getOrganizationById: no configured ID for an organization with ID ${organizationId}`);
    }
    return org;
  }

  async getRepos(options?: ICacheOptions): Promise<Repository[]> {
    const repos: Repository[] = [];
    const cacheOptions = options || {
      maxAgeSeconds: this._defaults.crossOrgsReposStaleSecondsPerOrg,
    };
    // CONSIDER: Cross-org functionality might be best in the GitHub library itself
    const orgs = this.organizations.values();
    for (let organization of orgs) {
      try {
        const organizationRepos = await organization.getRepositories(cacheOptions);
        repos.push(... organizationRepos);
      } catch (orgReposError) {
        console.dir(orgReposError);
      }
    }
    return repos;
  }

  getLinks(options?: any): Promise<ICorporateLink[]> {
    // Design change in the TypeScript version: this returns true link objects now,
    // but caches hydrated links behind the scenes
    options = options || {
      includeNames: true,
      includeId: true,
      includeServiceAccounts: true,
    };
    const caching = {
      maxAgeSeconds: options.maxAgeSeconds || this._defaults.corporateLinksStaleSeconds,
      backgroundRefresh: true,
    };
    delete options.maxAgeSeconds;
    delete options.backgroundRefresh;
    const linkProvider = this._linkProvider;
    options.lp = linkProvider.serializationIdentifierVersion;
    return new Promise((resolve, reject) => {
      return this._github.links.getCachedLinks(
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
        });
    });
  }

  async getLinksFromThirdPartyIds(thirdPartyIds: string[]): Promise<ICorporateLink[]> {
    const corporateLinks: ICorporateLink[] = [];
    const throttle = throat(ParallelLinkLookup);
    await Promise.all(thirdPartyIds.map(thirdPartyId => throttle(async () => {
      try {
        const link = await this.getLinkByThirdPartyId(thirdPartyId);
        if (link) {
          corporateLinks.push(link);
        }
      } catch (noLinkError) {
        console.dir(noLinkError);
      }
    })));
    return corporateLinks;
  }

  getLinkByThirdPartyId(thirdPartyId: string) : Promise<ICorporateLink> {
    const linkProvider = this._linkProvider;
    return linkProvider.getByThirdPartyId(thirdPartyId);
  }

  getLinkByThirdPartyUsername(username: string): Promise<ICorporateLink> {
    const linkProvider = this._linkProvider;
    return linkProvider.getByThirdPartyUsername(username);
  }

  getMailAddressFromCorporateUsername(corporateUsername: string): Promise<string> {
    if (!this.mailAddressProvider) {
      throw new Error('No mailAddressProvider available');
    }
    return GetAddressFromUpnAsync(this.mailAddressProvider, corporateUsername);
  }

  async getLinkWithOverhead(id: string, options?): Promise<ICorporateLink> {
    // TODO: remove function?
    console.log('* * * * * * * * * * * * /sd/sd/sd/sd/sd/sd getLinkWithOverhead * * * * * * * * * * * * * * * * * * * * ');
    // This literally retrieves the cache of all links. Which is silly, but quick and easy for now.
    const links = await this.getLinks(options);
    const reduced = links.filter(link => {
      // was 'ghid' in the prior implementation before link interfaces
      return link && link.thirdPartyId == id /* allow string comparisons */;
    });
    if (reduced.length > 1) {
      throw new Error(`Multiple links were present for the same GitHub user ${id}`);
    }
    return reduced.length === 1 ? reduced[0] : null;
    // TODO: return value went from false to null, is that new falsy ok?
  }

  getTeamsWithMembers(options?: ICrossOrganizationTeamMembership): Promise<any> {
    const cacheOptions: IPagedCrossOrganizationCacheOptions = {};
    options = options || {};
    cacheOptions.backgroundRefresh = options.backgroundRefresh !== undefined ? options.backgroundRefresh : true;
    cacheOptions.maxAgeSeconds = options.maxAgeSeconds || 60 * 10;
    cacheOptions.individualMaxAgeSeconds = options.individualMaxAgeSeconds;
    delete options.backgroundRefresh;
    delete options.maxAgeSeconds;
    delete options.individualMaxAgeSeconds;
    return this._github.crossOrganization.teamMembers(this._organizationNamesWithWithAuthorizationHeaders, options, cacheOptions);
  }

  getRepoCollaborators(options: IPagedCrossOrganizationCacheOptions): Promise<any> {
    const cacheOptions: IPagedCrossOrganizationCacheOptions = {};
    options = options || {};
    cacheOptions.backgroundRefresh = options.backgroundRefresh !== undefined ? options.backgroundRefresh : true;
    cacheOptions.maxAgeSeconds = options.maxAgeSeconds || 60 * 10;
    cacheOptions.individualMaxAgeSeconds = options.individualMaxAgeSeconds;
    delete options.backgroundRefresh;
    delete options.maxAgeSeconds;
    delete options.individualMaxAgeSeconds;
    return this._github.crossOrganization.repoCollaborators(this.organizationNamesWithWithAuthorizationHeaders, options, cacheOptions);
  }

  getRepoTeams(options: IPagedCrossOrganizationCacheOptions): Promise<any> {
    const cacheOptions: IPagedCrossOrganizationCacheOptions = {};
    options = options || {};
    cacheOptions.backgroundRefresh = options.backgroundRefresh !== undefined ? options.backgroundRefresh : true;
    cacheOptions.maxAgeSeconds = options.maxAgeSeconds || 60 * 10;
    cacheOptions.individualMaxAgeSeconds = options.individualMaxAgeSeconds;
    delete options.backgroundRefresh;
    delete options.maxAgeSeconds;
    delete options.individualMaxAgeSeconds;
    return this._github.crossOrganization.repoTeams(this.organizationNamesWithWithAuthorizationHeaders, options, cacheOptions);
  }

  async getCrossOrganizationTeams(options?: any): Promise<ICrossOrganizationMembersResult> {
    if (!options.maxAgeSeconds) {
      options.maxAgeSeconds = this._defaults.crossOrgsMembersStaleSecondsPerOrg;
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
    const values = await this._github.crossOrganization.teams(this.organizationNamesWithWithAuthorizationHeaders, options, cacheOptions);
    const results = crossOrganizationResults(this, values, 'id');
    return results;
  }

  async getMembers(options?: ICacheOptions): Promise<ICrossOrganizationMembersResult> {
    options = options || {};
    if (!options.maxAgeSeconds) {
      options.maxAgeSeconds = this._defaults.crossOrgsMembersStaleSecondsPerOrg;
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
    const values = await this._github.crossOrganization.orgMembers(this.organizationNamesWithWithAuthorizationHeaders, options, cacheOptions);
    const crossOrgReturn = crossOrganizationResults(this, values, 'id') as any as ICrossOrganizationMembersResult;
    return crossOrgReturn;
  }

  // Feature flags

  allowUnauthorizedNewRepositoryLockdownSystemFeature() {
    return this._config && this._config.features && this._config.features.allowUnauthorizedNewRepositoryLockdownSystem === true;
  }

  allowUnauthorizedForkLockdownSystemFeature() {
    // This feature has a hard dependency on the new repo lockdown system itself
    return this.allowUnauthorizedNewRepositoryLockdownSystemFeature() && this._config && this._config.features && this._config.features.allowUnauthorizedForkLockdownSystem === true;
  }

  allowTransferLockdownSystemFeature() {
    // This feature has a hard dependency on the new repo lockdown system itself
    return this.allowUnauthorizedNewRepositoryLockdownSystemFeature() && this._config && this._config.features && this._config.features.allowUnauthorizedTransferLockdownSystem === true;
  }

  allowUndoSystem() {
    return this._config && this._config.features && this._config.features.allowUndoSystem === true;
  }

  // Eventually link/unlink should move from context into operations here to centralize more than just the events

  async fireLinkEvent(value): Promise<void> {
    await fireEvent(this._config, 'link', value);
  }

  async fireUnlinkEvent(value): Promise<void> {
    await fireEvent(this._config, 'unlink', value);
  }

  get systemAccountsByUsername(): string[] {
    return this._config.github && this._config.github.systemAccounts ? this._config.github.systemAccounts.logins : [];
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

  authorizeCentralOperationsToken(): IGetAuthorizationHeader {
    const func = getCentralOperationsAuthorizationHeader.bind(null, this) as IGetAuthorizationHeader;
    return func;
  }

  getAccount(id: string) {
    const entity = { id };
    return new Account(entity, this, getCentralOperationsAuthorizationHeader.bind(null, this)); // getCentralOperationsToken.bind(null, this));
  }

  async getAccountWithDetailsAndLink(id: string): Promise<Account> {
    const account = this.getAccount(id);
    return await account.getDetailsAndLink();
  }

  async getAuthenticatedAccount(token: string): Promise<Account> {
    const github = this._github;
    const parameters = {};
    try {
      const entity = await github.post(`token ${token}`, 'users.getAuthenticated', parameters);
      const account = new Account(entity, this, getCentralOperationsAuthorizationHeader.bind(null, this));
      return account;
    } catch (error) {
      throw wrapError(error, 'Could not get details about the authenticated account');
    }
  }

  getTeamByIdWithOrganization(id: number, organizationName: string, entity?: any): Team {
    const organization = this.getOrganization(organizationName);
    return organization.team(id, entity);
  }

  getRepositoryWithOrganization(name: string, organizationName: string, entity?: any): Repository {
    const organization = this.getOrganization(organizationName);
    return organization.repository(name, entity);
  }

  async getAccountByUsername(username: string, options?: ICacheOptions): Promise<Account> {
    options = options || {};
    const operations = this;
    if (!username) {
      throw new Error('Must provide a GitHub username to retrieve account information.');
    }
    const parameters = {
      username: username,
    };
    const cacheOptions: ICacheOptions = {
      maxAgeSeconds: options.maxAgeSeconds || operations._defaults.accountDetailStaleSeconds,
    };
    if (options.backgroundRefresh !== undefined) {
      cacheOptions.backgroundRefresh = options.backgroundRefresh;
    }
    try {
      const getHeaderFunction = getCentralOperationsAuthorizationHeader(this);
      const authorizationHeader = await getHeaderFunction(AppPurpose.Data);
      const entity = await operations._github.call(authorizationHeader, 'users.getByUsername', parameters, cacheOptions);
      const account = new Account(entity, this, getCentralOperationsAuthorizationHeader.bind(null, this));
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

  async sendMail(mail: IMail): Promise<any> {
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

  async emailRender(emailViewName: string, contentOptions: any): Promise<string> {
    const appDirectory = this.config.typescript.appDirectory;
    return await RenderHtmlMail(appDirectory, emailViewName, contentOptions);
  }
}

interface IFireEventResult {
  url: string;
  value: string;
  body: string;
  headers: any;
  statusCode: any;
}

async function fireEvent(config, configurationName, value): Promise<IFireEventResult[]> {
  if (!config || !config.github || !config.github.links || !config.github.links.events || !config.github.links.events) {
    return;
  }
  const userAgent = config.userAgent || 'Unknown user agent';
  const httpUrls = config.github.links.events.http;
  if (!httpUrls || !httpUrls[configurationName]) {
    return;
  }
  const urlOrUrls = httpUrls[configurationName];
  let urls = Array.isArray(urlOrUrls) ? urlOrUrls : [urlOrUrls];
  let results: IFireEventResult[] = [];
  for (const httpUrl of urls) {
    try {
      const { statusCode, body, headers } = await rp({
        method: 'POST',
        uri: httpUrl,
        json: true,
        body: value,
        headers: {
          'User-Agent': userAgent,
          'X-Repos-Event': configurationName,
        },
        resolveWithFullResponse: true,
      });
      results.push({
        url: httpUrl,
        value,
        headers,
        body,
        statusCode,
      });
    } catch (ignoredTechnicalError) {
      /* ignored */
      console.log();
    }
  }
  return results;
}

function getCentralOperationsAuthorizationHeader(self: Operations): IPurposefulGetAuthorizationHeader {
  const s = (self || this) as Operations;
  if (s.config.github && s.config.github.operations && s.config.github.operations.centralOperationsToken) {
    const capturedToken = s.config.github.operations.centralOperationsToken;
    return async () => {
      return {
        value: `token ${capturedToken}`,
        purpose: null, // legacy
        source: 'central operations token',
      };
    };
  } else if (s.getOrganizations.length === 0) {
    throw new Error('No central operations token nor any organizations configured.');
  }
  // Fallback to the first configured organization as a convenience
  // CONSIDER: would randomizing the organization be better, or a priority based on known-rate limit remaining?
  const firstOrganization = s.getOrganizations()[0];
  return firstOrganization.getAuthorizationHeader();
}

function setRequiredProperties(self, properties, options) {
  for (let i = 0; i < properties.length; i++) {
    const key = properties[i];
    if (!options[key]) {
      throw new Error(`Required option with key "${key}" was not provided.`);
    }
    const privateKey = `_${key}`;
    self[privateKey] = options[key];
  }
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

async function getPromisedLinks(linkProvider: ILinkProvider): Promise<IPromisedLinks> {
  // TODO: consider looking at the options as to how to include/exclude properties etc.
  // today (TypeScript update with PGSQL) the 'options' have zero impact on what is actually returned...
  const links = await linkProvider.getAll();
  const jsonLinks = linkProvider.dehydrateLinks(links);
  const dataObject: IPromisedLinks = {
    headers: {
      'type': 'links',
    },
    data: jsonLinks,
  };
  return dataObject;
}

function restartAfterDynamicConfigurationUpdate(minimumSeconds: number, maximumSeconds: number, appInitialized: Date, organizationSettingsProvider: OrganizationSettingProvider) {
  didDynamicConfigurationUpdate(appInitialized, organizationSettingsProvider).then(changed => {
    if (changed) {
      const randomSeconds = Math.floor(Math.random() * (maximumSeconds - minimumSeconds + 1) + minimumSeconds);
      console.log(`changes to dynamic configuration detected since ${appInitialized}, restarting in ${randomSeconds}s`);
      setInterval(() => {
        console.log(`shutting down process due to dynamic configuration changes being detected at least ${randomSeconds} seconds ago...`);
        return process.exit(0);
      }, randomSeconds * 1000);
      if (DynamicRestartCheckHandle) {
        clearInterval(DynamicRestartCheckHandle);
      }
    }
  }).catch(error => {
    console.dir(error);
  });
}

async function didDynamicConfigurationUpdate(appInitialized: Date, organizationSettingsProvider: OrganizationSettingProvider): Promise<boolean> {
  try {
    const allOrganizations = await organizationSettingsProvider.queryAllOrganizations();
    const activeOrganizations = allOrganizations.filter(org => org.active);
    for (const organization of activeOrganizations) {
      if (organization.updated > appInitialized) {
        console.log(`organization ${organization.organizationName} was updated ${organization.updated} vs app started time of ${appInitialized}`);
        return true;
      }
    }
  } catch (updateOrganizationsError) {
    console.dir(updateOrganizationsError);
  }
  return false;
}