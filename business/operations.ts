//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

/*eslint no-console: ["error", { allow: ["warn"] }] */

'use strict';

import async = require('async');

import { ICacheOptions, IMapPlusMetaCost, IProviders } from '../transitional';

import { Account } from './account';
import { GraphManager } from './graphManager';
import { Organization } from './organization';
import { UserContext } from './user/context';
import { ILinkProvider } from '../lib/linkProviders/postgres/postgresLinkProvider';

const request = require('requestretry');

const emailRender = require('../lib/emailRender');

import { wrapError } from '../utils';
import { ICorporateLink } from './corporateLink';

// defaults could move to configuration alternatively
const defaults = {
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

export enum UnlinkPurpose {
  Unknown = 'unknown',
  Termination = 'termination', // no longer listed as an employee
  Self = 'self', // the user self-service unlink themselves
  Operations = 'operations', // operational support
  Deleted = 'deleted', // the GitHub account has been deleted or does not exist
};

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
  private _mailAddressProvider: any;
  private _mailProvider: any;
  private _graphManager: GraphManager;
  private _github: any;
  private _config: any;
  private _insights: any;
  private _redis: any;
  private _defaults: any;
  private _organizationNames: any;
  private _organizations: Map<string, Organization>;
  private _organizationOriginalNames: any;
  private _organizationNamesWithTokens: any;

  // LEAK:START
  private _userContext: any; // leaky
  // LEAK:END

  get providers(): IProviders {
    return this._providers;
  }

  get baseUrl(): string {
    return this._baseUrl;
  }

  get mailAddressProvider(): any {
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

  get github(): any {
    return this._github;
  }

  get defaults(): any {
    return this._defaults;
  }

  get config(): any {
    return this._config;
  }

  get insights(): any {
    return this._insights;
  }

  constructor(options) {
    setRequiredProperties(this, ['github', 'config', 'insights', 'redis'], options);

    this._providers = options;
    this._baseUrl = '/';

    this._defaults = Object.assign({}, defaults);
    this._mailAddressProvider = options.mailAddressProvider;
    this._mailProvider = options.mailProvider;
    this._linkProvider = options.linkProvider as ILinkProvider;

    this._graphManager = new GraphManager(this, options);

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

  getOnboardingOrganization(name) {
    // Specialized method to retrieve a new organization via the onboarding configuration collection, if any
    const value = getAlternateOrganization(this, name, 'onboarding');
    if (value) {
      return value;
    }
    throw new Error(`No onboarding organization settings configured for the ${name} organization`);
  }

  isIgnoredOrganization(name) {
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

  getOrganizationOriginalNames() {
    if (!this._organizationOriginalNames) {
      const names = [];
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
    return currentManagerIfAny;
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
      await account.getDetailsAndDirectLinkAsync();
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
      history.push(... await account.removeManagedOrganizationMembershipsAsync());
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
      history.push(... await account.removeLinkAsync());
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
      managementInformation: cachedEmployeeManagementInfo,
      purpose,
      details,
    });

    await this.sendMail(mail);
  }

  getOrganization(name: string, callback?) {
    const lc = name.toLowerCase();
    const organization = this.organizations.get(lc);
    if (!organization) {
      throw new Error(`Could not find configuration for the "${name}" organization.`);
    }
    if (callback) {
      return callback(null, organization);
    }
    return organization;
  }

  getUserContext(userId) {
    // This will leak per user for the app runtime. Can use a LRU or limiting cache in the future if needed.
    if (!this._userContext) {
      this._userContext = new Map();
    }
    userId = typeof(userId) === 'string' ? parseInt(userId, 10) : userId;
    const contexts = this._userContext;
    let user = contexts.get(userId);
    if (!user) {
      user = new UserContext(this, userId);
      contexts.set(userId, user);
    }
    return user;
  }

  getRepos(options, callback) {
    const repos = [];
    if (!callback && typeof (options) === 'function') {
      callback = options;
      options = null;
    }
    const cacheOptions = options || {
      maxAgeSeconds: this._defaults.crossOrgsReposStaleSecondsPerOrg,
    };
    // CONSIDER: Cross-org functionality might be best in the GitHub library itself
    const orgs = this.organizations.values();
    async.eachLimit(
      orgs,
      this._defaults.crossOrgsReposParallelCalls,
      (organization: Organization, next) => {
        organization.getRepositories(cacheOptions, (getReposError, orgRepos) => {
          if (!getReposError) {
            for (let i = 0; i < orgRepos.length; i++) {
              repos.push(orgRepos[i]);
            }
          }
          return next(getReposError);
        });
      },
      (error) => {
        return callback(error ? error : null, error ? null : repos);
      });
  }

  getLinks(options, callback) {
    // Design change in the TypeScript version: this returns true link objects now,
    // but caches hydrated links behind the scenes
    if (!callback && typeof (options) === 'function') {
      callback = options;
      options = null;
    }
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
    const getPromisedLinks = function() {
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
    return this._github.links.getCachedLinks(
      getPromisedLinks,
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
          return callback(ee);
        }
        callback(null, rehydratedLinks);
      });
//      callback);
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

  getLinkWithOverheadAsync(id, options): Promise<ICorporateLink> {
    return new Promise((resolve, reject) => {
      this.getLinkWithOverhead(id, options, (error, link) => {
        return error ? reject(error) : resolve(link as ICorporateLink);
      });
    });
  }

  getLinkWithOverhead(id, options, callback?) {
    console.log('* * * * * * * * * * * * /sd/sd/sd/sd/sd/sd getLinkWithOverhead * * * * * * * * * * * * * * * * * * * * ');
    // This literally retrieves the cache of all links. Which is silly, but quick and easy for now.
    if (!callback && typeof (options) === 'function') {
      callback = options;
      options = null;
    }
    const self = this;
    self.getLinks(options, (getLinksError, links) => {
      if (getLinksError) {
        return callback(getLinksError);
      }
      const reduced = links.filter(link => {
        // was 'ghid' in the prior implementation before link interfaces
        return link && link.thirdPartyId == id /* allow string comparisons */;
      });
      if (reduced.length > 1) {
        return callback(new Error('Multiple links were present for the same GitHub user'));
      }
      return callback(null, reduced.length === 1 ? reduced[0] : false);
    });
  }

  getTeamsWithMembers(orgName, options, callback) {
    const cacheOptions: ICacheOptions = {};
    options = options || {};
    cacheOptions.backgroundRefresh = options.backgroundRefresh !== undefined ? options.backgroundRefresh : true;
    cacheOptions.maxAgeSeconds = options.maxAgeSeconds || 60 * 10;
    cacheOptions.individualMaxAgeSeconds = options.individualMaxAgeSeconds;
    delete options.backgroundRefresh;
    delete options.maxAgeSeconds;
    delete options.individualMaxAgeSeconds;

    this._github.crossOrganization.teamMembers(this.organizationNamesWithTokens, options, cacheOptions, callback);
  }

  getRepoCollaborators(orgName, options, callback) {
    const cacheOptions: ICacheOptions = {};
    options = options || {};
    cacheOptions.backgroundRefresh = options.backgroundRefresh !== undefined ? options.backgroundRefresh : true;
    cacheOptions.maxAgeSeconds = options.maxAgeSeconds || 60 * 10;
    cacheOptions.individualMaxAgeSeconds = options.individualMaxAgeSeconds;
    delete options.backgroundRefresh;
    delete options.maxAgeSeconds;
    delete options.individualMaxAgeSeconds;

    this._github.crossOrganization.repoCollaborators(this.organizationNamesWithTokens, options, cacheOptions, callback);
  }

  getRepoTeams(orgName, options, callback) {
    const cacheOptions: ICacheOptions = {};
    options = options || {};
    cacheOptions.backgroundRefresh = options.backgroundRefresh !== undefined ? options.backgroundRefresh : true;
    cacheOptions.maxAgeSeconds = options.maxAgeSeconds || 60 * 10;
    cacheOptions.individualMaxAgeSeconds = options.individualMaxAgeSeconds;
    delete options.backgroundRefresh;
    delete options.maxAgeSeconds;
    delete options.individualMaxAgeSeconds;

    this._github.crossOrganization.repoTeams(this.organizationNamesWithTokens, options, cacheOptions, callback);
  }

  getTeams(orgName, options, callback) {
    if (!callback && typeof(options) === 'function') {
      callback = options;
      options = {};
    } else if (!callback && !options && typeof(orgName) === 'function') {
      callback = orgName;
      options = {};
      orgName = null;
    }
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
    if (!orgName) {
      return this._github.crossOrganization.teams(
        this.organizationNamesWithTokens,
        options,
        cacheOptions,
        (error, values) => {
          return callback(error ? error : null, error ? null : crossOrganizationResults(this, values, 'id'));
        });
    }
    this.getOrganization(orgName).getTeams(cacheOptions, callback);
  }

  getMembers(orgName, options, callback) {
    if (!callback && typeof(options) === 'function') {
      callback = options;
      options = {};
    } else if (!callback && !options && typeof(orgName) === 'function') {
      callback = orgName;
      options = {};
      orgName = null;
    }
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

    if (!orgName) {
      return this._github.crossOrganization.orgMembers(
        this.organizationNamesWithTokens,
        options,
        cacheOptions,
        (error, values) => {
          return callback(error ? error : null, error ? null : crossOrganizationResults(this, values, 'id'));
        });
    }
    const combinedOptions = Object.assign(options, cacheOptions);
    this.getOrganization(orgName).getMembers(combinedOptions, callback);
  }

  // Eventually link/unlink should move from context into operations here to centralize more than just the events

  fireLinkEvent(value, callback?) {
    fireEvent(this._config, 'link', value, callback);
  }

  fireUnlinkEvent(value, callback?) {
    fireEvent(this._config, 'unlink', value, callback);
  }

  get systemAccountsByUsername() {
    return this._config.github && this._config.github.systemAccounts ? this._config.github.systemAccounts.logins : [];
  }

  get disasterRecoveryConfiguration() {
    return this._config.github && this._config.github.disasterRecovery ? this._config.github.disasterRecovery : null;
  }

  isSystemAccountByUsername(username) {
    const lc = username.toLowerCase();
    const usernames = this.systemAccountsByUsername;
    for (let i = 0; i < usernames.length; i++) {
      if (usernames[i].toLowerCase() === lc) {
        return true;
      }
    }
    return false;
  }

  getAccount(id) {
    // TODO: Centralized "accounts" local store
    const entity = { id: id };
    return new Account(entity, this, getCentralOperationsToken.bind(null, this));
  }

  getAccountWithDetailsAndLink(id, callback) {
    const account = this.getAccount(id);
    return account.getDetailsAndLink(callback);
  }

  getAuthenticatedAccount(token, options, callback) {
    if (!callback && typeof(options) === 'function') {
      callback = options;
      options = null;
    }
    options = options || {};
    const github = this._github;
    const parameters = {};
    return github.post(token, 'users.getAuthenticated', parameters, (error, entity) => {
      if (error) {
        return callback(wrapError(error, 'Could not get details about the authenticated account'));
      }
      const account = new Account(entity, this, getCentralOperationsToken.bind(null, this));
      return callback(null, account);
    });
  }

  getTeamById(id, options, callback) {
    if (!callback && typeof(options) === 'function') {
      callback = options;
      options = null;
    }
    options = options || {};
    const self = this;
    getTeamDetailsById(this, id, options, (error, entity) => {
      if (entity && !entity.organization) {
        error = new Error(`Team ${id} response did not have an associated organization`);
      }
      const organizationName = entity.organization.login;
      let organization = null;
      try {
        organization = self.getOrganization(organizationName);
      } catch (er) {
        error = er;
      }
      if (error) {
        return callback(error);
      }
      return callback(null, organization.teamFromEntity(entity));
    });
  }

  getAccountByUsername(username, options, callback) {
    if (!callback && typeof(options) === 'function') {
      callback = options;
      options = null;
    }
    options = options || {};
    const token = getCentralOperationsToken(this);
    const operations = this;
    if (!username) {
      return callback(new Error('Must provide a GitHub username to retrieve account information.'));
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
        return callback(error);
      } else if (error) {
        return callback(wrapError(error, `Could not get details about account "${username}".`));
      }
      const account = new Account(entity, this, getCentralOperationsToken.bind(null, this));
      return callback(null, account);
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
}

function getTeamDetailsById(self, id, options, callback) {
  if (!callback && typeof(options) === 'function') {
    callback = options;
    options = null;
  }
  options = options || {};
  const token = getCentralOperationsToken(self);
  const operations = self;
  if (!id) {
    return callback(new Error('Must provide a GitHub team ID to retrieve team information'));
  }
  const parameters = {
    team_id: id,
  };
  const cacheOptions: ICacheOptions = {
    maxAgeSeconds: options.maxAgeSeconds || operations.defaults.teamDetailStaleSeconds,
  };
  if (options.backgroundRefresh !== undefined) {
    cacheOptions.backgroundRefresh = options.backgroundRefresh;
  }
  return operations.github.call(token, 'teams.get', parameters, cacheOptions, callback);
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

function createOrganization(self, name, settings?) {
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

function crossOrganizationResults(operations, results, keyProperty) {
  keyProperty = keyProperty || 'id';
  if (results && results.data) {
    // This debug aid can be removed anytime in Sept. 2017
    console.warn('results.data present in cross-organization results (SHOULD be flattened instead)');
  }
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
