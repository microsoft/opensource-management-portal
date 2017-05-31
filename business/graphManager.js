//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

const moment = require('moment');

class GraphManager {
  constructor(operations, options) {
    setRequiredProperties(this, ['github', 'config', 'redis', 'insights'], options);
    _private(this).operations = operations;

    return this;
  }

  getCachedLink(githubId, options, callback) {
    // Advice: this function is designed for efficiently at this time
    // and not ensuring a link, since it uses a cache system. For
    // making actual link calls, it would be best to use an alternate
    // call.
    if (!callback && typeof(options) === 'function') {
      callback = options;
      options = null;
    }
    options = options || {};

    const localCacheMaxAgeSeconds = options.localMaxAgeSeconds || 30; // 30s
    const remoteCacheMaxAgeSeconds = options.maxAgeSeconds || 60; // 1m
    let backgroundRefresh = options.backgroundRefresh !== undefined ? options.backgroundRefresh : true;

    getCachedLinksMap(this, localCacheMaxAgeSeconds, remoteCacheMaxAgeSeconds, backgroundRefresh, (error, map) => {
      return error ? callback(error) : callback(null, map.get(githubId));
    });
  }

  getMember(githubId, options, callback) {
    const self = this;
    self.getMembers(options, (error, allMembers) => {
      if (error) {
        return callback(error);
      }
      githubId = typeof(githubId) === 'string' ? parseInt(githubId, 10) : githubId;
      const member = raiseCrossOrganizationSingleResult(allMembers.get(githubId));
      return callback(null, member);
    });
  }

  getUserTeams(githubId, options, callback) {
    const self = this;
    self.getTeamsWithMembers(options, (error, everything) => {
      if (error) {
        return callback(error);
      }
      githubId = typeof(githubId) === 'string' ? parseInt(githubId, 10) : githubId;
      const teams = [];
      for (let i = 0; i < everything.length; i++) {
        const oneTeam = everything[i];
        if (oneTeam && oneTeam.members) {
          for (let j = 0; j < oneTeam.members.length; j++) {
            if (githubId === oneTeam.members[j].id) {
              const teamClone = Object.assign({}, oneTeam);
              oneTeam.organization = {
                login: oneTeam.organization.login,
              };
              delete teamClone.members;
              teams.push(teamClone);
              break;
            }
          }
        }
      }
      return callback(null, teams);
    });
  }

  getTeamsWithMembers(options, callback) {
    if (typeof(options) === 'function' && !callback) {
      callback = options;
      options = null;
    }
    options = options || {};

    if (!options.maxAgeSeconds) {
      options.maxAgeSeconds = 60 * 30 * 48 * 10 /* 2 WEEKS */ /* 2 DAYS */ /* 30m per-org full team members list OK */;
    }
    if (options.backgroundRefresh === undefined) {
      options.backgroundRefresh = true;
    }
    options.individualMaxAgeSeconds = 7 * 24 * 60 * 60; // One week

    _private(this).operations.getTeamsWithMembers(null, options, callback);
  }

  getUserReposByTeamMemberships(githubId, options, callback) {
    const self = this;
    self.getUserTeams(githubId, {}, (error, everything) => {
      if (error) {
        return callback(error);
      }
      const teams = new Set();
      for (let i = 0; i < everything.length; i++) {
        teams.add(everything[i].id);
      }
      self.getReposWithTeams(options, (getReposError, allRepos) => {
        if (getReposError) {
          return callback(getReposError);
        }
        const repos = [];
        for (let i = 0; i < allRepos.length; i++) {
          const repo = allRepos[i];
          if (repo && repo.teams) {
            const userTeams = [];
            let bestPermission = null;
            for (let j = 0; j < repo.teams.length; j++) {
              const t = repo.teams[j];
              if (teams.has(t.id)) {
                if (repo.private === false && t.permission === 'pull') {
                  // Public repos, ignore teams with pull access
                } else {
                  userTeams.push(t);
                  if (isPermissionBetterThan(bestPermission, t.permission)) {
                    bestPermission = t.permission;
                  }
                }
              }
            }
            if (userTeams.length > 0) {
              const personalizedRepo = {
                personalized: {
                  teams: userTeams,
                  permission: bestPermission,
                },
              };
              const repoClone = Object.assign(personalizedRepo, repo);
              delete repoClone.teams;
              repos.push(repoClone);
            }
          }
        }
        return callback(null, repos);
      });
    });
  }

  getReposWithTeams(options, callback) {
    if (typeof(options) === 'function' && !callback) {
      callback = options;
      options = null;
    }
    options = options || {};

    if (!options.maxAgeSeconds) {
      options.maxAgeSeconds = 60 * 20 /* 20m per-org collabs list OK */;
    }
    options.individualMaxAgeSeconds = 7 * 24 * 60 * 60; // One week
    if (options.backgroundRefresh === undefined) {
      options.backgroundRefresh = true;
    }

    _private(this).operations.getRepoTeams(null, options, callback);
  }

  getReposWithCollaborators(options, callback) {
    if (typeof(options) === 'function' && !callback) {
      callback = options;
      options = null;
    }
    options = options || {};

    if (!options.maxAgeSeconds) {
      options.maxAgeSeconds = 60 * 20 /* 20m per-org collabs list OK */;
    }
    options.individualMaxAgeSeconds = 7 * 24 * 60 * 60; // One week
    if (options.backgroundRefresh === undefined) {
      options.backgroundRefresh = true;
    }

    _private(this).operations.getRepoCollaborators(null, options, callback);
  }

  getMembers(options, callback) {
    if (typeof(options) === 'function' && !callback) {
      callback = options;
      options = null;
    }
    options = options || {};

    if (!options.maxAgeSeconds) {
      options.maxAgeSeconds = 60 * 10 /* 10m per-org members list OK */;
    }
    if (options.backgroundRefresh === undefined) {
      options.backgroundRefresh = true;
    }

    _private(this).operations.getMembers(null, options, callback);
  }
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

function isPermissionBetterThan(currentBest, newConsideration) {
  switch (newConsideration) {
  case 'admin':
    return true;
  case 'push':
    if (currentBest !== 'admin') {
      return true;
    }
    break;
  case 'pull':
    if (currentBest === null) {
      return true;
    }
    break;
  default:
    throw new Error(`Invalid permission type ${newConsideration}`);
  }
  return false;
}

module.exports = GraphManager;

function raiseCrossOrganizationSingleResult(result, keyProperty) {
  keyProperty = keyProperty || 'id';
  if (!result || !result[keyProperty] || !result.orgs) {
    return;
  }
  const parentValue = result[keyProperty];
  const clone = Object.assign({}, result);
  clone.orgs = [];
  let copiedFirst = false;
  for (const orgName of Object.getOwnPropertyNames(result.orgs)) {
    const orgResult = result.orgs[orgName];
    if (!orgResult[keyProperty]) {
      throw new Error(`The result for the "${orgName}" org does not have a key property, "${keyProperty}".`);
    }
    if (orgResult[keyProperty] !== parentValue) {
      throw new Error(`The result for the "${orgName}" org key property, "${keyProperty}" does not match the parent key value.`);
    }
    if (orgResult.orgs) {
      throw new Error(`The result for the "${orgName}" org has a nested 'orgs' property, which is not allowed.`);
    }
    if (!copiedFirst) {
      Object.assign(clone, orgResult);
      copiedFirst = true;
    }
    clone.orgs.push(orgName);
  }
  return clone;
}

function getCachedLinksMap(self, maxAgeSecondsLocal, maxAgeSecondsRemote, backgroundRefresh, callback) {
  const privates = _private(self);

  const operations = privates.operations;

  if (!privates.linksCache) {
    privates.linksCache = {};
  }
  let linksCache = privates.linksCache;

  const now = moment();
  const beforeNow = moment().subtract(maxAgeSecondsLocal, 'seconds');
  let isCacheValid = linksCache.map && linksCache.updated && beforeNow.isAfter(linksCache.updated);

  if (isCacheValid) {
    return callback(null, linksCache.map);
  }

  const remoteOptions = {
    backgroundRefresh: backgroundRefresh,
    maxAgeSeconds: maxAgeSecondsRemote,
    // Include all available information
    includeNames: true,
    includeId: true,
    includeServiceAccounts: true,
  };
  operations.getLinks(remoteOptions, (getLinksError, links) => {
    if (getLinksError) {
      return callback(getLinksError);
    }
    const map = new Map();
    for (let i = 0; i < links.length; i++) {
      let id = links[i].ghid;
      if (id) {
        id = parseInt(id, 10);
        map.set(id, links[i]);
      }
    }
    if (linksCache.map && linksCache.updated.isAfter(now)) {
      // Abandon this update, a newer update has already returned
    } else {
      linksCache.updated = now;
      linksCache.map = map;
    }
    return callback(null, linksCache.map);
  });
}

const privateSymbol = Symbol();
function _private(self) {
  if (self[privateSymbol] === undefined) {
    self[privateSymbol] = {};
  }
  return self[privateSymbol];
}
