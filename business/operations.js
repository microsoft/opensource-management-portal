//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

const async = require('async');

const Account = require('./account');
const GraphManager = require('./graphManager');
const Organization = require('./organization');
const UserContext = require('./user/context');
const wrapError = require('../utils').wrapError;

// defaults could move to configuration alternatively
const defaults = {
  orgReposStaleSeconds: 60 * 15 /* 15m */,
  orgRepoTeamsStaleSeconds: 60 * 3 /* 3m */,
  orgRepoCollaboratorsStaleSeconds: 60 * 30 /* 30m */,
  orgRepoCollaboratorStaleSeconds: 30 /* half minute */,
  orgRepoDetailsStaleSeconds: 60 * 5 /* 5m */,
  orgTeamsStaleSeconds: 60 * 5 /* 5m */,
  orgTeamsSlugLookupStaleSeconds: 30 /* half a minute */,
  orgMembersStaleSeconds: 60 * 30 /* 30m */,
  teamMaintainersStaleSeconds: 60 * 2 /* 2m */,
  orgMembershipStaleSeconds: 60 * 5 /* 5m */,
  orgMembershipDirectStaleSeconds: 30 /* 30s */,
  crossOrgsReposStaleSecondsPerOrg: 60 * 60 * 2 /* 2 hours per org */,
  crossOrgsReposParallelCalls: 3,
  crossOrgsMembersStaleSecondsPerOrg: 60 * 60 * 2 /* 2 hours per org */,
  crossOrgsMembersParallelCalls: 5,
  corporateLinksStaleSeconds: 60 * 5 /* 5m */,
  repoBranchesStaleSeconds: 60 * 5 /* 5m */,
  accountDetailStaleSeconds: 60 * 60 * 24 /* 24h */,
  orgRepoWebhooksStaleSeconds: 60 * 60 * 8 /* 8h */,
  teamRepositoryPermissionStaleSeconds: 0 /* 0m */,
};

class Operations {
  constructor(options) {
    setRequiredProperties(this, ['github', 'config', 'dataClient', 'insights', 'redis'], options);

    this.providers = options;
    this.baseUrl = '/';

    this.defaults = Object.assign({}, defaults);
    this.mailAddressProvider = options.mailAddressProvider;
    this.mailProvider = options.mailProvider;

    this.graphManager = new GraphManager(this, options);

    return this;
  }

  get organizationNames() {
    if (!_private(this).organizationNames) {
      const names = [];
      for (let i = 0; i < this.config.github.organizations.length; i++) {
        names.push(this.config.github.organizations[i].name.toLowerCase());
      }
      _private(this).organizationNames = names;
    }
    return _private(this).organizationNames;
  }

  get organizations() {
    if (!_private(this).organizations) {
      const organizations = {};
      const names = this.organizationNames;
      for (let i = 0; i < names.length; i++) {
        const organization = createOrganization(this, names[i]);
        organizations[names[i]] = organization;
      }
      _private(this).organizations = organizations;
    }
    return _private(this).organizations;
  }

  getOnboardingOrganization(name) {
    // Specialized method to retrieve a new organization via the onboarding configuration collection, if any
    name = name.toLowerCase();
    const onboardingList = this.config.github.organizations.onboarding;
    if (onboardingList) {
      for (let i = 0; i < onboardingList.length; i++) {
        const settings = onboardingList[i];
        if (settings && settings.name && settings.name.toLowerCase() === name) {
          return createOrganization(this, name, settings);
        }
      }
    }
    throw new Error(`No onboarding organization settings configured for the ${name} organization`);
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
    if (!_private(this).organizationOriginalNames) {
      const names = [];
      for (let i = 0; i < this.config.github.organizations.length; i++) {
        names.push(this.config.github.organizations[i].name);
      }
      _private(this).organizationOriginalNames = names;
    }
    return _private(this).organizationOriginalNames;
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
    if (!_private(this).organizationNamesWithTokens) {
      const tokens = {};
      for (let i = 0; i < this.config.github.organizations.length; i++) {
        const name = this.config.github.organizations[i].name.toLowerCase();
        const token = this.config.github.organizations[i].ownerToken;
        tokens[name] = token;
      }
      _private(this).organizationNamesWithTokens = tokens;
    }
    return _private(this).organizationNamesWithTokens;
  }

  getOrganization(name, callback) {
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
    if (!_private(this).userContext) {
      _private(this).userContext = new Map();
    }
    userId = typeof(userId) === 'string' ? parseInt(userId, 10) : userId;
    const contexts = _private(this).userContext;
    let user = contexts.get(userId);
    if (!user) {
      user = new UserContext(this, userId);
      contexts.set(userId, user);
    }
    return user;
  }

  getRepos(callback) {
    const repos = [];
    const cacheOptions = {
      maxAgeSeconds: this.defaults.crossOrgsReposStaleSecondsPerOrg,
    };
    // CONSIDER: Cross-org functionality might be best in the GitHub library itself
    const orgs = this.organizations;
    async.eachLimit(
      orgs,
      this.defaults.crossOrgsReposParallelCalls,
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
      maxAgeSeconds: options.maxAgeSeconds || this.defaults.corporateLinksStaleSeconds,
      backgroundRefresh: true,
    };
    delete options.maxAgeSeconds;
    delete options.backgroundRefresh;
    return this.github.links.getLinks(
      options,
      caching,
      callback);
  }

  getTeamsWithMembers(orgName, options, callback) {
    const cacheOptions = {};
    options = options || {};
    cacheOptions.backgroundRefresh = options.backgroundRefresh !== undefined ? options.backgroundRefresh : true;
    cacheOptions.maxAgeSeconds = options.maxAgeSeconds || 60 * 10;
    cacheOptions.individualMaxAgeSeconds = options.individualMaxAgeSeconds;
    delete options.backgroundRefresh;
    delete options.maxAgeSeconds;
    delete options.individualMaxAgeSeconds;

    this.github.crossOrganization.teamMembers(this.organizationNamesWithTokens, options, cacheOptions, callback);
  }

  getRepoCollaborators(orgName, options, callback) {
    const cacheOptions = {};
    options = options || {};
    cacheOptions.backgroundRefresh = options.backgroundRefresh !== undefined ? options.backgroundRefresh : true;
    cacheOptions.maxAgeSeconds = options.maxAgeSeconds || 60 * 10;
    cacheOptions.individualMaxAgeSeconds = options.individualMaxAgeSeconds;
    delete options.backgroundRefresh;
    delete options.maxAgeSeconds;
    delete options.individualMaxAgeSeconds;

    this.github.crossOrganization.repoCollaborators(this.organizationNamesWithTokens, options, cacheOptions, callback);
  }

  getRepoTeams(orgName, options, callback) {
    const cacheOptions = {};
    options = options || {};
    cacheOptions.backgroundRefresh = options.backgroundRefresh !== undefined ? options.backgroundRefresh : true;
    cacheOptions.maxAgeSeconds = options.maxAgeSeconds || 60 * 10;
    cacheOptions.individualMaxAgeSeconds = options.individualMaxAgeSeconds;
    delete options.backgroundRefresh;
    delete options.maxAgeSeconds;
    delete options.individualMaxAgeSeconds;

    this.github.crossOrganization.repoTeams(this.organizationNamesWithTokens, options, cacheOptions, callback);
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
    if (!orgName) {
      return this.github.crossOrganization.teams(
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

    if (!orgName) {
      return this.github.crossOrganization.orgMembers(
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

  get systemAccountsByUsername() {
    return this.config.github && this.config.github.systemAccounts ? this.config.github.systemAccounts.logins : [];
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

  getAuthenticatedAccount(token, options, callback) {
    if (!callback && typeof(options) === 'function') {
      callback = options;
      options = null;
    }
    options = options || {};
    const operations = _private(this).operations;
    const parameters = {};
    return operations.github.post(token, 'users.get', parameters, (error, entity) => {
      if (error) {
        return callback(wrapError(error, 'Could not get details about the authenticated account'));
      }
      const account = new Account(entity, this, getCentralOperationsToken.bind(null, this));
      return callback(null, account);
    });
  }

  getAccountByUsername(username, options, callback) {
    if (!callback && typeof(options) === 'function') {
      callback = options;
      options = null;
    }
    options = options || {};
    const token = _private(this).getCentralOperationsToken();
    const operations = _private(this).operations;
    if (!username) {
      return callback(new Error('Must provide a GitHub username to retrieve account information.'));
    }
    const parameters = {
      username: username,
    };
    const cacheOptions = {
      maxAgeSeconds: options.maxAgeSeconds || operations.defaults.accountDetailStaleSeconds,
    };
    if (options.backgroundRefresh !== undefined) {
      cacheOptions.backgroundRefresh = options.backgroundRefresh;
    }
    return operations.github.call(token, 'users.getForUser', parameters, cacheOptions, (error, entity) => {
      if (error) {
        return callback(wrapError(error, `Could not get details about account "${username}".`));
      }
      const account = new Account(entity, this, getCentralOperationsToken.bind(null, this));
      return callback(null, account);
    });
  }
}

function getCentralOperationsToken(self) {
  if (self.config.github.organizations.length <= 0) {
    throw new Error('No organizations configured.');
  }
  const firstOrganization = self.config.github.organizations[0];
  return firstOrganization.ownerToken;
}

function createOrganization(self, name, settings) {
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
    self[key] = options[key];
  }
}

module.exports = Operations;

function crossOrganizationResults(operations, results, keyProperty) {
  keyProperty = keyProperty || 'id';
  const map = new Map();
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
  map.meta = results.meta;
  map.cost = results.cost;
  return map;
}

const privateSymbol = Symbol();
function _private(self) {
  if (self[privateSymbol] === undefined) {
    self[privateSymbol] = {};
  }
  return self[privateSymbol];
}
