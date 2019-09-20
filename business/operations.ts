//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

/*eslint no-console: ["error", { allow: ["warn"] }] */

'use strict';

import async = require('async');

import { ICacheOptions, IMapPlusMetaCost, IProviders, IPagedCrossOrganizationCacheOptions } from '../transitional';

import { Account } from './account';
import { GraphManager } from './graphManager';
import { Organization } from './organization';
import { UserContext } from './user/context';
import { ILinkProvider } from '../lib/linkProviders/postgres/postgresLinkProvider';

const request = require('requestretry');

const emailRender = require('../lib/emailRender');

import { wrapError } from '../utils';
import { ICorporateLink } from './corporateLink';
import { Repository } from './repository';
import { ILibraryContext } from '../lib/github';
import { RedisHelper } from '../lib/redis';
import { IMailAddressProvider } from '../lib/mailAddressProvider';
import { Team } from './team';
import { OrganizationMember } from './organizationMember';

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

export enum UnlinkPurpose {
  Unknown = 'unknown',
  Termination = 'termination', // no longer listed as an employee
  Self = 'self', // the user self-service unlink themselves
  Operations = 'operations', // operational support
  Deleted = 'deleted', // the GitHub account has been deleted or does not exist
};

export interface ICrossOrganizationMembershipBasics {
  id: string;
  login: string;
  avatar_url: string;
}

export interface ICrossOrganizationMembershipByOrganization {
  id: number; // ?
  orgs: any; // object[orgName] = theirGitHubaccount entity avatar_url, id, login : ICrossOrganizationMembershipBasics
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
  private _providers: IProviders;
  private _baseUrl: string;
  private _linkProvider: ILinkProvider;
  private _mailAddressProvider: IMailAddressProvider;
  private _mailProvider: any;
  private _graphManager: GraphManager;
  private _github: ILibraryContext;
  private _config: any;
  private _insights: any;
  private _redis: RedisHelper;
  private _defaults: ICacheDefaultTimes;
  private _organizationNames: any;
  private _organizations: Map<string, Organization>;
  private _organizationOriginalNames: any;
  private _organizationNamesWithTokens: any;
  private _defaultPageSize: number;

  // LEAK:START
  private _userContext: Map<string, UserContext>; // leaky
  // LEAK:END

  get providers(): IProviders {
    return this._providers;
  }

  get baseUrl(): string {
    return this._baseUrl;
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

  get github(): ILibraryContext  {
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
    setRequiredProperties(this, ['github', 'config', 'insights', 'redis'], options);

    this._providers = options;
    this._baseUrl = '/';

    this._defaults = Object.assign({}, defaults);
    this._mailAddressProvider = options.mailAddressProvider;
    this._mailProvider = options.mailProvider;
    this._linkProvider = options.linkProvider as ILinkProvider;

    this._graphManager = new GraphManager(this);

    this._defaultPageSize = this.config && this.config.github && this.config.github.api && this.config.github.api.defaultPageSize ? this.config.github.api.defaultPageSize : defaultGitHubPageSize;

    return this;
  }

  get organizationNames() {
    if (!this._organizationNames) {
      const names = [];
      for (let i = 0; i < this._config.github.organizations.length; i++) {
        names.push(this._config.github.organizations[i].name.toLowerCase());
      }
      this._organizationNames = names;
    }
    return this._organizationNames;
  }

  get organizations() {
    if (!this._organizations) {
      const organizations = new Map<string, Organization>();
      const names = this.organizationNames;
      for (let i = 0; i < names.length; i++) {
        const organization = createOrganization(this, names[i]);
        organizations.set(names[i], organization);
      }
      this._organizations = organizations;
    }
    return this._organizations;
  }

  get legalEntities() {
    const config = this._config;
    if (config.cla && config.cla.entities) {
      return config.cla.entities;
    }
  }

  getOnboardingOrganization(name: string) {
    // Specialized method to retrieve a new organization via the onboarding configuration collection, if any
    const value = getAlternateOrganization(this, name, 'onboarding');
    if (value) {
      return value;
    }
    throw new Error(`No onboarding organization settings configured for the ${name} organization`);
  }

  isIgnoredOrganization(name: string): boolean {
    const value = getAlternateOrganization(this, name, 'onboarding') || getAlternateOrganization(this, name, 'ignore');
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

  getOrganizationOriginalNames(): string[] {
    if (!this._organizationOriginalNames) {
      const names: string[] = [];
      for (let i = 0; i < this._config.github.organizations.length; i++) {
        names.push(this._config.github.organizations[i].name);
      }
      this._organizationOriginalNames = names;
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

  get organizationNamesWithTokens() {
    if (!this._organizationNamesWithTokens) {
      const tokens = {};
      for (let i = 0; i < this._config.github.organizations.length; i++) {
        const name = this._config.github.organizations[i].name.toLowerCase();
        const token = this._config.github.organizations[i].ownerToken;
        tokens[name] = token;
      }
      this._organizationNamesWithTokens = tokens;
    }
    return this._organizationNamesWithTokens;
  }

  async getCachedEmployeeManagementInformation(corporateId: string): Promise<ICachedEmployeeInformation> {
    const key = `${RedisPrefixManagerInfoCache}${corporateId}`;
    const currentManagerIfAny = await this._redis.getObjectCompressedAsync(key);
    return currentManagerIfAny as ICachedEmployeeInformation;
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
      companyName: this.config.brand.companyName,
      managementInformation: cachedEmployeeManagementInfo,
      purpose,
      details,
    });

    await this.sendMail(mail);
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

  getUserContext(userId: string | number): UserContext {
    // This will leak per user for the app runtime. Can use a LRU or limiting cache in the future if needed.
    // CONSIDER: improve here to remove leak
    const id = (typeof(userId) === 'string' ? parseInt(userId, 10) : userId as unknown as string) as string;
    if (!this._userContext) {
      this._userContext = new Map<string, UserContext>();
    }
    const contexts = this._userContext;
    let user = contexts.get(id);
    if (!user) {
      user = new UserContext(this, id);
      contexts.set(id, user);
    }
    return user;
  }

  async getRepos(options?: ICacheOptions): Promise<Repository[]> {
    const repos: Repository[] = [];
    const cacheOptions = options || {
      maxAgeSeconds: this._defaults.crossOrgsReposStaleSecondsPerOrg,
    };
    // CONSIDER: Cross-org functionality might be best in the GitHub library itself
    const orgs = this.organizations.values();
    for (let organization of orgs) {
      const organizationRepos = await organization.getRepositories(cacheOptions);
      repos.push(... organizationRepos);
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

  getLinkByThirdPartyId(thirdPartyId: string) : Promise<ICorporateLink> {
    return new Promise((resolve, reject) => {
      const linkProvider = this._linkProvider;
      linkProvider.getByThirdPartyId(thirdPartyId, (error, link) => {
        return error ? reject(error) : resolve(link as ICorporateLink);
      })
    });
  }

  getLinkByThirdPartyUsername(username: string): Promise<ICorporateLink> {
    return new Promise((resolve, reject) => {
      const linkProvider = this._linkProvider;
      linkProvider.getByThirdPartyUsername(username, (error, link) => {
        return error ? reject(error) : resolve(link as ICorporateLink);
      });
    });
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

  getTeamsWithMembers(options?: IPagedCrossOrganizationCacheOptions): Promise<any> {
    return new Promise((resolve, reject) => {
      const cacheOptions: IPagedCrossOrganizationCacheOptions = {};
      options = options || {};
      cacheOptions.backgroundRefresh = options.backgroundRefresh !== undefined ? options.backgroundRefresh : true;
      cacheOptions.maxAgeSeconds = options.maxAgeSeconds || 60 * 10;
      cacheOptions.individualMaxAgeSeconds = options.individualMaxAgeSeconds;
      delete options.backgroundRefresh;
      delete options.maxAgeSeconds;
      delete options.individualMaxAgeSeconds;

      this._github.crossOrganization.teamMembers(this.organizationNamesWithTokens, options, cacheOptions, (error, ok) => {
        return error ? reject(error) : resolve(ok);
      });
    });
  }

  getRepoCollaborators(options: IPagedCrossOrganizationCacheOptions): Promise<any> {
    return new Promise((resolve, reject) => {
      const cacheOptions: IPagedCrossOrganizationCacheOptions = {};
      options = options || {};
      cacheOptions.backgroundRefresh = options.backgroundRefresh !== undefined ? options.backgroundRefresh : true;
      cacheOptions.maxAgeSeconds = options.maxAgeSeconds || 60 * 10;
      cacheOptions.individualMaxAgeSeconds = options.individualMaxAgeSeconds;
      delete options.backgroundRefresh;
      delete options.maxAgeSeconds;
      delete options.individualMaxAgeSeconds;

      this._github.crossOrganization.repoCollaborators(this.organizationNamesWithTokens, options, cacheOptions, (error, ok) => {
        return error ? reject(error) : resolve(ok);
      });
    });
  }

  getRepoTeams(options: IPagedCrossOrganizationCacheOptions): Promise<any> {
    return new Promise((resolve, reject) => {
      const cacheOptions: IPagedCrossOrganizationCacheOptions = {};
      options = options || {};
      cacheOptions.backgroundRefresh = options.backgroundRefresh !== undefined ? options.backgroundRefresh : true;
      cacheOptions.maxAgeSeconds = options.maxAgeSeconds || 60 * 10;
      cacheOptions.individualMaxAgeSeconds = options.individualMaxAgeSeconds;
      delete options.backgroundRefresh;
      delete options.maxAgeSeconds;
      delete options.individualMaxAgeSeconds;

      this._github.crossOrganization.repoTeams(this.organizationNamesWithTokens, options, cacheOptions, (error, ok) => {
        return error ? reject(error) : resolve(ok);
      });
    });
  }

  getCrossOrganizationTeams(options?: any): Promise<ICrossOrganizationMembersResult> {
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
    return new Promise((resolve, reject) => {
      return this._github.crossOrganization.teams(
        this.organizationNamesWithTokens,
        options,
        cacheOptions,
        (error, values) => {
          if (error) {
            return reject(error);
          }
          const results = crossOrganizationResults(this, values, 'id');
          return resolve(results);
        });
      });
  }

  getMembers(options?: ICacheOptions): Promise<ICrossOrganizationMembersResult> {
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
    return new Promise((resolve, reject) => {
      return this._github.crossOrganization.orgMembers(
      this.organizationNamesWithTokens,
      options,
      cacheOptions,
      (error, values) => {
        // TODO: refactor cross org return results?
        const crossOrgReturn = crossOrganizationResults(this, values, 'id') as any as ICrossOrganizationMembersResult;
        return error ? reject(error) : resolve(crossOrgReturn);
      });
    });
  }

  // Eventually link/unlink should move from context into operations here to centralize more than just the events

  fireLinkEvent(value, callback?) {
    fireEvent(this._config, 'link', value, callback);
  }

  fireUnlinkEvent(value, callback?) {
    fireEvent(this._config, 'unlink', value, callback);
  }

  get systemAccountsByUsername(): string[] {
    return this._config.github && this._config.github.systemAccounts ? this._config.github.systemAccounts.logins : [];
  }

  get disasterRecoveryConfiguration() {
    return this._config.github && this._config.github.disasterRecovery ? this._config.github.disasterRecovery : null;
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

  getAccount(id: string) {
    // TODO: Centralized "accounts" local store
    const entity = { id };
    return new Account(entity, this, getCentralOperationsToken.bind(null, this));
  }

  async getAccountWithDetailsAndLink(id: string): Promise<Account> {
    const account = this.getAccount(id);
    return await account.getDetailsAndLink();
  }

  getAuthenticatedAccount(token: string): Promise<Account> {
    return new Promise((resolve, reject) => {
      const github = this._github;
      const parameters = {};
      return github.post(token, 'users.getAuthenticated', parameters, (error, entity) => {
        if (error) {
          return reject(wrapError(error, 'Could not get details about the authenticated account'));
        }
        const account = new Account(entity, this, getCentralOperationsToken.bind(null, this));
        return resolve(account);
      });
    });
  }

  async getTeamById(id: string, options?: ICacheOptions): Promise<Team> {
    options = options || {};
    const self = this;
    if (typeof(id) === 'number') {
      throw new Error(`should not be a number: ${id}`);
    }
    const entity = await this.getTeamDetailsById(id, options);
    let error = null;
    if (entity && !entity.organization) {
      error = new Error(`Team ${id} response did not have an associated organization`);
    }
    const organizationName = entity.organization.login;
    let organization: Organization = null;
    try {
      organization = self.getOrganization(organizationName);
    } catch (er) {
      error = er;
    }
    if (error) {
      throw error;
    }
    return organization.teamFromEntity(entity);
  }

  getAccountByUsername(username: string, options?: ICacheOptions): Promise<Account> {
    return new Promise((resolve, reject) => {
      options = options || {};
      const token = getCentralOperationsToken(this);
      const operations = this;
      if (!username) {
        return reject(Error('Must provide a GitHub username to retrieve account information.'));
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
      return operations._github.call(token, 'users.getByUsername', parameters, cacheOptions, (error, entity) => {
        if (error && error.code && error.code === 404) {
          error = new Error(`The GitHub username ${username} could not be found (or was deleted)`);
          error.code = 404;
          return reject(error);
        } else if (error) {
          return reject(wrapError(error, `Could not get details about account ${username}: ${error.message}`));
        }
        const account = new Account(entity, this, getCentralOperationsToken.bind(null, this));
        return resolve(account);
      });
    });
  }

  async sendMail(mail: any): Promise<any> {
    const mailProvider = this.providers.mailProvider;
    const insights = this.providers.insights;
    return new Promise((resolve, reject) => {
      mailProvider.sendMail(mail, (mailError, mailResult) => {
        const customData = {
          receipt: mailResult,
          eventName: undefined,
        };
        if (mailError) {
          customData.eventName = 'ManagerUnlinkMailFailure';
          insights.trackException({ exception: mailError, properties: customData });
        }
        insights.trackEvent({ name: 'ManagerUnlinkMailSuccess', properties: customData });
        return mailError ? reject(mailError) : resolve(mailResult);
      });
    });
  }

  async emailRender(emailViewName: string, contentOptions: any): Promise<string> {
    const appDirectory = this.config.typescript.appDirectory;
    return new Promise((resolve, reject) => {
      emailRender.render(appDirectory, emailViewName, contentOptions, (renderError, mailContent) => {
        return renderError ? reject(renderError) : resolve(mailContent);
      });
    });
  }


  private getTeamDetailsById(id: string, options: ICacheOptions): Promise<any> {
    return new Promise((resolve, reject) => {
      options = options || {};
      const token = getCentralOperationsToken(this);
      if (!id) {
        return reject(new Error('Must provide a GitHub team ID to retrieve team information'));
      }
      const parameters = {
        team_id: id,
      };
      const cacheOptions: ICacheOptions = {
        maxAgeSeconds: options.maxAgeSeconds || this.defaults.teamDetailStaleSeconds,
      };
      if (options.backgroundRefresh !== undefined) {
        cacheOptions.backgroundRefresh = options.backgroundRefresh;
      }
      return this.github.call(token, 'teams.get', parameters, cacheOptions, (error, ok) => {
        return error ? reject(error) : resolve(ok);
      });
    });
  }
}

function fireEvent(config, configurationName, value, callback?) {
  callback = callback || function () {};
  if (!config || !config.github || !config.github.links || !config.github.links.events || !config.github.links.events) {
    return callback();
  }
  const userAgent = config.userAgent || 'Unknown user agent';
  const httpUrls = config.github.links.events.http;
  if (!httpUrls || !httpUrls[configurationName]) {
    return callback();
  }
  const urlOrUrls = httpUrls[configurationName];
  let urls = Array.isArray(urlOrUrls) ? urlOrUrls : [urlOrUrls];
  let results = [];
  return async.eachLimit(urls, 1, (httpUrl, next) => {
    request.post({
      url: httpUrl,
      json: true,
      body: value,
      headers: {
        'User-Agent': userAgent,
        'X-Repos-Event': configurationName,
      },
    }, (postError, response, body) => {
      results.push({
        url: httpUrl,
        value: value,
        error: postError,
        response: response,
        body: body,
      });
      return next();
    });
  }, asyncError => {
    return callback(asyncError, results);
  });
}

function getCentralOperationsToken(self) {
  const s = self || this;
  if (s.config.github && s.config.github.operations && s.config.github.operations.centralOperationsToken) {
    return s.config.github.operations.centralOperationsToken;
  } else if (s.config.github.organizations.length <= 0) {
    throw new Error('No central operations token nor any organizations configured.');
  }
  // Fallback to the first configured organization as a convenience
  const firstOrganization = s.config.github.organizations[0];
  return firstOrganization.ownerToken;
}

function createOrganization(self: Operations, name: string, settings?): Organization {
  name = name.toLowerCase();
  if (!settings) {
    const group = self.config.github.organizations;
    for (let i = 0; i < group.length; i++) {
      if (group[i].name && group[i].name.toLowerCase() === name) {
        settings = group[i];
        break;
      }
    }
  }
  if (!settings) {
    throw new Error(`This application is not configured for the ${name} organization`);
  }
  return new Organization(self, name, settings);
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

function getAlternateOrganization(self, name, alternativeType) {
  const lowercase = name.toLowerCase();
  const list = self.config.github.organizations[alternativeType];
  if (list) {
    for (let i = 0; i < list.length; i++) {
      const settings = list[i];
      if (settings && settings.name && settings.name.toLowerCase() === lowercase) {
        return createOrganization(self, lowercase, settings);
      }
    }
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

function getPromisedLinks(linkProvider: ILinkProvider) {
  return new Promise((resolve, reject) => {
    // TODO: consider looking at the options as to how to include/exclude properties etc.
    // today (TypeScript update with PGSQL) the 'options' have zero impact on what is actually returned...
    linkProvider.getAll((error, links) => {
      if (error) {
        return reject(error);
      }
      const jsonLinks = linkProvider.dehydrateLinks(links);
      const dataObject = {
        headers: {
          'type': 'links',
        },
        data: jsonLinks,
      };
      return resolve(dataObject);
    });
  });
};
