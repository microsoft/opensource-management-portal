//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

/*eslint no-console: ["error", { allow: ["warn"] }] */

'use strict';

import async = require('async');

import { ICacheOptions, IMapPlusMetaCost } from '../transitional';

import { Account } from './account';
import { GraphManager } from './graphManager';
import { Organization } from './organization';
import { UserContext } from './user/context';
import { ILinkProvider } from '../lib/linkProviders/postgres/postgresLinkProvider';

const request = require('requestretry');

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

export class Operations {
  private _providers: any;
  private _baseUrl: string;
  private _linkProvider: ILinkProvider;
  private _mailAddressProvider: any;
  private _mailProvider: any;
  private _graphManager: GraphManager;
  private _github: any;
  private _config: any;
  private _dataClient: any;
  private _insights: any;
  private _redis: any;
  private _defaults: any;
  private _organizationNames: any;
  private _organizations: any;
  private _organizationOriginalNames: any;
  private _organizationNamesWithTokens: any;

  // LEAK:START
  private _userContext: any; // leaky
  // LEAK:END

  get providers(): any {
    return this._providers;
  }

  get dataClient(): any {
    return this._dataClient;
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
      const organizations = {};
      const names = this.organizationNames;
      for (let i = 0; i < names.length; i++) {
        const organization = createOrganization(this, names[i]);
        organizations[names[i]] = organization;
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

  getOrganizations(organizationList) {
    if (!organizationList) {
      return this.organizations;
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

  async terminateAccount(thirdPartyId, options?: any): Promise<void> {
    // This is the equivalent to legacy processPendingUnlink
    // Intent: common code path for unlinking whether self-service or by admins
    // Missing: removing any cached link (since caching is being removed for now)
    const self = this;
    const redis = self._redis;
    options = options || {};
    return new Promise<void>((resolve, reject) => {
      const redisKey = 'pendingunlinks';
      const fixedAuthScheme = 'aad';
      const id = thirdPartyId;
      const account = self.getAccount(id);
      const reason = options.reason || 'Automated processPendingUnlink operation';
      account.terminate({ reason: reason }, (error, history) => {
        // TODO: removeSetMember by UPN
        // history.push(`Removing pending unlink entry from Redis for ${upn}`);
        // self.redis.removeSetMember(redisKey, upn, function (err) {
        //   if (err) {
        //     history.push(`Remove pending unlink set member error with Redis: ${err.message}`);
        //     return callback(err, history);
        //   }
        //   callback(null, history);
        // });
        return error ? reject(error) : resolve(history);
      });
    });
  }

  getOrganization(name: string, callback?) {
    const lc = name.toLowerCase();
    const organization = this.organizations[lc];
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
    const orgs = this.organizations;
    async.eachLimit(
      orgs,
      this._defaults.crossOrgsReposParallelCalls,
      (organization, next) => {
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
    return github.post(token, 'users.get', parameters, (error, entity) => {
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
    return operations._github.call(token, 'users.getForUser', parameters, cacheOptions, (error, entity) => {
      if (error) {
        return callback(wrapError(error, `Could not get details about account "${username}".`));
      }
      const account = new Account(entity, this, getCentralOperationsToken.bind(null, this));
      return callback(null, account);
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
    id: id,
  };
  const cacheOptions: ICacheOptions = {
    maxAgeSeconds: options.maxAgeSeconds || operations.defaults.teamDetailStaleSeconds,
  };
  if (options.backgroundRefresh !== undefined) {
    cacheOptions.backgroundRefresh = options.backgroundRefresh;
  }
  return operations.github.call(token, 'orgs.getTeam', parameters, cacheOptions, callback);
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
