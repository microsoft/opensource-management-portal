//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

import moment from 'moment';

import { ICorporateLink } from './corporateLink';
import { ICacheOptions, ILocalCacheOptions, IPagedCacheOptions, IPagedCrossOrganizationCacheOptions } from '../transitional';
import { Operations } from './operations';

interface ILocalLinksCache {
  updated: moment.Moment;
  map: Map<string, ICorporateLink>;
}

export class GraphManager {
  private _operations: Operations;
  private _linksCache: ILocalLinksCache;

  constructor(operations) {
    this._operations = operations;

    return this;
  }

  async getCachedLink(githubId: string, options?: ILocalCacheOptions): Promise<ICorporateLink> {
    // Advice: this function is designed for efficiently at this time
    // and not ensuring a link, since it uses a cache system. For
    // making actual link calls, it would be best to use an alternate
    // call.
    options = options || {};
    const localCacheMaxAgeSeconds = options.localMaxAgeSeconds || 30; // 30s
    const remoteCacheMaxAgeSeconds = options.maxAgeSeconds || 60; // 1m
    let backgroundRefresh = options.backgroundRefresh !== undefined ? options.backgroundRefresh : true;
    const map = await this.getCachedLinksMap(localCacheMaxAgeSeconds, remoteCacheMaxAgeSeconds, backgroundRefresh);
    return map.get(githubId);
  }

  async getMember(githubId: string | number, options?: ICacheOptions): Promise<any> {
    const allMembers = await this.getMembers(options);
    githubId = typeof(githubId) === 'string' ? parseInt(githubId, 10) : githubId;
    const member = raiseCrossOrganizationSingleResult(allMembers.get(githubId));
    return member;
  }

  async getUserTeams(githubId: string | number, options: ICacheOptions): Promise<any[]> {
    const everything = await this.getTeamsWithMembers(options);
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
    return teams;
  }

  getTeamsWithMembers(options: IPagedCrossOrganizationCacheOptions): Promise<any[]> {
    options = options || {};
    if (!options.maxAgeSeconds) {
      options.maxAgeSeconds = 60 * 30 * 48 * 10 /* 2 WEEKS */ /* 2 DAYS */ /* 30m per-org full team members list OK */;
    }
    if (options.backgroundRefresh === undefined) {
      options.backgroundRefresh = true;
    }
    options.individualMaxAgeSeconds = 7 * 24 * 60 * 60; // One week
    return this._operations.getTeamsWithMembers(options);
  }

  async getUserReposByTeamMemberships(githubId: string | number, options: ICacheOptions): Promise<any> {
    const everything = await this.getUserTeams(githubId, {}); // TODO:CONFIRM: should this pass options down or not?
    const teams = new Set();
    for (let i = 0; i < everything.length; i++) {
      teams.add(everything[i].id);
    }
    const allRepos = await this.getReposWithTeams(options);
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
    return repos;
  }

  getReposWithTeams(options?: IPagedCrossOrganizationCacheOptions): Promise<any> {
    options = options || {};
    if (!options.maxAgeSeconds) {
      options.maxAgeSeconds = 60 * 20 /* 20m per-org collabs list OK */;
    }
    options.individualMaxAgeSeconds = 7 * 24 * 60 * 60; // One week
    if (options.backgroundRefresh === undefined) {
      options.backgroundRefresh = true;
    }
    return this._operations.getRepoTeams(options);
  }

  getReposWithCollaborators(options: IPagedCrossOrganizationCacheOptions): Promise<any> {
    options = options || {};
    if (!options.maxAgeSeconds) {
      options.maxAgeSeconds = 60 * 20 /* 20m per-org collabs list OK */;
    }
    options.individualMaxAgeSeconds = 7 * 24 * 60 * 60; // One week
    if (options.backgroundRefresh === undefined) {
      options.backgroundRefresh = true;
    }
    return this._operations.getRepoCollaborators(options);
  }

  getMembers(options: IPagedCrossOrganizationCacheOptions): Promise<any> {
    options = options || {};
    if (!options.maxAgeSeconds) {
      options.maxAgeSeconds = 60 * 10 /* 10m per-org members list OK */;
    }
    if (options.backgroundRefresh === undefined) {
      options.backgroundRefresh = true;
    }
    return this._operations.getMembers(options);
  }

  private async getCachedLinksMap(
    maxAgeSecondsLocal: number,
    maxAgeSecondsRemote: number,
    backgroundRefresh: boolean): Promise<Map<string, ICorporateLink>> {
    const operations = this._operations;
    if (!this._linksCache) {
      this._linksCache = {
        updated: null,
        map: new Map(),
      };
    }
    const linksCache = this._linksCache;
    const now = moment();
    const beforeNow = moment().subtract(maxAgeSecondsLocal, 'seconds');
    let isCacheValid = linksCache.map && linksCache.updated && beforeNow.isAfter(linksCache.updated);
    if (isCacheValid) {
      return linksCache.map;
    }
    const remoteOptions = {
      backgroundRefresh: backgroundRefresh,
      maxAgeSeconds: maxAgeSecondsRemote,
      // Include all available information
      includeNames: true,
      includeId: true,
      includeServiceAccounts: true,
    };
    const links = await operations.getLinks(remoteOptions);
    const map = new Map();
    for (let i = 0; i < links.length; i++) {
      const link = links[i] as ICorporateLink;
      let id : string | number = link.thirdPartyId;
      if (id) {
        id = parseInt(id, 10);
        map.set(id, links[i]);
      }
    }
    if (linksCache.map && linksCache.updated && linksCache.updated.isAfter(now)) {
      // Abandon this update, a newer update has already returned
    } else {
      linksCache.updated = now;
      linksCache.map = map;
    }
    return linksCache.map;
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

function raiseCrossOrganizationSingleResult(result, keyProperty?: string) {
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
