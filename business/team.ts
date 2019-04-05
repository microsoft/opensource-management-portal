//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

import * as common from './common';

import { wrapError } from '../utils';

const teamPrimaryProperties = [
  'id',
  'name',
  'slug',
  'description',
  'members_count',
  'repos_count',
  'created_at',
  'updated_at',
];
const teamSecondaryProperties = [
  'privacy',
  'permission',
  'organization',
  'url',
  'members_url',
  'repositories_url',
];

const _ = require('lodash');
import async = require('async');
import { Organization } from './organization';
import { Operations } from './operations';
import { ICacheOptions } from '../transitional';
import { TeamMember } from './teamMember';
import { TeamRepositoryPermission } from './teamRepositoryPermission';

export class Team {
  public static PrimaryProperties = teamPrimaryProperties;

  private _organization: Organization;
  private _operations: Operations;
  private _getToken: any;

  private _id: string;

  private _slug?: string;
  private _name?: string;

  private _created_at?: any;
  private _updated_at?: any;

  private _description: string;

  private _repos_count: any;
  private _members_count: any;

  private _detailsEntity?: any;

  get id(): string {
    // NOTE: GitHub's library has renamed this to team_id
    return this._id;
  }

  get name(): string {
    return this._name;
  }

  get slug(): string {
    return this._slug;
  }

  get description(): string {
    return this._description;
  }

  get repos_count(): any {
    return this._repos_count;
  }

  get members_count(): any {
    return this._members_count;
  }

  get created_at(): any {
    return this._created_at;
  }

  get updated_at(): any {
    return this._updated_at;
  }

  get organization(): Organization {
    return this._organization;
  }

  constructor(organization: Organization, entity, getToken, operations: Operations) {
    if (!entity || !entity.id) {
      throw new Error('Team instantiation requires an incoming entity, or minimum-set entity containing an id property.');
    }

    this._organization = organization;
    common.assignKnownFieldsPrefixed(this, entity, 'team', teamPrimaryProperties, teamSecondaryProperties);

    this._getToken = getToken;
    this._operations = operations;
  }

  get baseUrl() {
    if (this._organization && (this._slug || this._name)) {
      return this._organization.baseUrl + 'teams/' + (this._slug || this._name) + '/';
    }
    const operations = this._operations;
    return operations.baseUrl + 'teams?q=' + this._id;
  }

  ensureName(callback) {
    if (this._name && this._slug) {
      return callback();
    }
    this.getDetails(callback);
  }

  getDetails(options, callback?) {
    const self = this;
    if (!callback && typeof (options) === 'function') {
      callback = options;
      options = null;
    }
    options = options || {};
    const operations = this._operations;
    const cacheOptions = {
      maxAgeSeconds: options.maxAgeSeconds || operations.defaults.orgTeamDetailsStaleSeconds,
      backgroundRefresh: false,
    };
    if (options.backgroundRefresh !== undefined) {
      cacheOptions.backgroundRefresh = options.backgroundRefresh;
    }
    const token = this._getToken();
    const id = this._id;
    if (!id) {
      return callback(new Error('No "id" property associated with the team instance to retrieve the details for.'));
    }
    // CONSIDER: Either a time-based cache or ability to override the local cached behavior
    if (this._detailsEntity) {
      return callback(null, this._detailsEntity);
    }
    const parameters = {
      id: id,
    };
    return operations.github.call(token, 'orgs.getTeam', parameters, cacheOptions, (error, entity) => {
      // CONSIDER: What if the team is gone? (404)
      if (error) {
        return callback(wrapError(error, 'Could not get details about the team'));
      }
      this._detailsEntity = entity;
      common.assignKnownFieldsPrefixed(self, entity, 'team', teamPrimaryProperties, teamSecondaryProperties);
      callback(null, entity);
    });
  }

  get isBroadAccessTeam() {
    const teams = this._organization.broadAccessTeams;
    const res = teams.indexOf(this._id);
    return res >= 0;
  }

  get isSystemTeam() {
    const systemTeams = this._organization.systemTeamIds;
    const res = systemTeams.indexOf(this._id);
    return res >= 0;
  }

  delete(callback) {
    const operations = this._operations;
    const token = this._getToken();
    const github = operations.github;

    const parameters = {
      id: this._id,
    };
    github.post(token, 'orgs.deleteTeam', parameters, callback);
  }

  edit(patch, callback) {
    const operations = this._operations;
    const token = this._getToken();
    const github = operations.github;

    const parameters = {
      id: this._id,
    };
    delete patch.id;
    Object.assign(parameters, patch);

    github.post(token, 'orgs.editTeam', parameters, callback);
  }

  removeMembership(username, callback) {
    const operations = this._operations;
    const token = this._getToken();
    const github = operations.github;

    const parameters = {
      id: this._id,
      username: username,
    };
    github.post(token, 'orgs.removeTeamMembership', parameters, callback);
  }

  addMembership(username, options, callback?) {
    const operations = this._operations;
    const token = this._getToken();
    const github = operations.github;
    if (!callback && typeof(options) === 'function') {
      callback = options;
      options = null;
    }
    options = options || {};

    const role = options.role || 'member';

    const parameters = {
      team_id: this._id,
      username: username,
      role: role,
    };
    github.post(token, 'orgs.addTeamMembership', parameters, callback);
  }

  addMaintainer(username, callback) {
    const options = {
      role: 'maintainer',
    };
    this.addMembership(username, options, callback);
  }

  getMembership(username, options, callback) {
    const operations = this._operations;
    const token = this._getToken();
    if (!callback && typeof(options) === 'function') {
      callback = options;
      options = null;
    }
    options = options || {};
    if (!options.maxAgeSeconds) {
      options.maxAgeSeconds = operations.defaults.orgMembershipDirectStaleSeconds;
    }
    // If a background refresh setting is not present, perform a live
    // lookup with this call. This is the opposite of most of the library's
    // general behavior.
    if (options.backgroundRefresh === undefined) {
      options.backgroundRefresh = false;
    }
    const parameters = {
      team_id: this._id,
      username: username,
    };
    // TODO: this should probably be a _post_ call and not _call_ as there is no cache with GitHub
    return operations.github.call(token, 'orgs.getTeamMembership', parameters, (error, result) => {
      if (error && error.code === 404) {
        result = false;
        error = null;
      }
      if (error) {
        let reason = error.message;
        if (error.code) {
          reason += ' ' + error.code;
        }
        const wrappedError = wrapError(error, `Trouble retrieving the membership for "${username}" in team ${this._id}. ${reason}`);
        if (error.code) {
          wrappedError['code'] = error.code;
        }
        return callback(wrappedError);
      }
      return callback(null, result);
    });
  }

  getMembershipEfficiently(username, options, callback?) {
    // Hybrid calls are used to check for membership. Since there is
    // often a relatively fresh cache available of all of the members
    // of a team, that data source is used first to avoid a unique
    // GitHub API call.
    const operations = this._operations;
    const self = this;
    // A background cache is used that is slightly more aggressive
    // than the standard org members list to at least frontload a
    // refresh of the data.
    if (!callback && typeof(options) === 'function') {
      callback = options;
      options = null;
    }
    options = options || {};
    if (!options.maxAgeSeconds) {
      options.maxAgeSeconds = operations.defaults.orgMembershipStaleSeconds;
    }
    self.isMaintainer(username, options, (getMaintainerError, isMaintainer) => {
      if (getMaintainerError) {
        return callback(getMaintainerError);
      }
      if (isMaintainer) {
        return callback(null, 'maintainer');
      }
      self.isMember(username, 'member', options, (getError, isMember) => {
        if (getError) {
          return callback(getError);
        }
        if (isMember) {
          return callback(null, 'member');
        }
        // Fallback to the standard membership lookup
        const membershipOptions = {
          maxAgeSeconds: operations.defaults.orgMembershipDirectStaleSeconds,
        };
        self.getMembership(username, membershipOptions, (getMembershipError, result) => {
          if (getMembershipError) {
            return callback(getMembershipError);
          }
          return callback(null, result.role, result.state);
        });
      });
    });
  }

  isMaintainer(username, options, callback) {
    return this.isMember(username, 'maintainer', options, callback);
  }

  isMember(username, role, options, callback) {
    if (!callback && !options && typeof (role) === 'function') {
      callback = role;
      options = null;
      role = null;
    }
    if (!callback && typeof (options) === 'function') {
      callback = options;
      options = null;
    }
    options = options || {};
    const operations = this._operations;
    role = role || 'member';
    options = options || {};
    if (!options.maxAgeSeconds) {
      options.maxAgeSeconds = operations.defaults.orgMembershipStaleSeconds;
    }
    this.getMembers(Object.assign({ role: role }, options), (getMembersError, members) => {
      if (getMembersError) {
        return callback(getMembersError);
      }
      const expected = username.toLowerCase();
      for (let i = 0; i < members.length; i++) {
        const member = members[i];
        if (member.login.toLowerCase() === expected) {
          return callback(null, role);
        }
      }
      return callback(null, false);
    });
  }

  getMaintainers(options, callback?) {
    if (!callback && typeof (options) === 'function') {
      callback = options;
      options = null;
    }
    options = options || {};
    if (!options.maxAgeSeconds) {
      options.maxAgeSeconds = this._operations.defaults.teamMaintainersStaleSeconds;
    }
    const getMemberOptions = Object.assign({
      role: 'maintainer',
    }, options);
    this.getMembers(getMemberOptions, callback);
  }

  getMembers(options, callback?) {
    if (!callback && typeof (options) === 'function') {
      callback = options;
      options = null;
    }
    options = options || {};


    let operations = this._operations;
    let token = this._getToken();
    let github = operations.github;

    let parameters: IGetMembersParameters = {
      id: this.id,
      per_page: 100,
    };
    const caching: ICacheOptions = {
      maxAgeSeconds: options.maxAgeSeconds || operations.defaults.orgMembersStaleSeconds,
      backgroundRefresh: true,
    };
    if (options && options.backgroundRefresh === false) {
      caching.backgroundRefresh = false;
    }
    if (options.role) {
      parameters.role = options.role;
    }
    if (options.pageLimit) {
      parameters.pageLimit = options.pageLimit;
    }
    // CONSIDER: Check the error object, if present, for error.code === 404 to alert/store telemetry on deleted teams
    return github.collections.getTeamMembers(
      token,
      parameters,
      caching,
      common.createInstancesCallback(this, this.memberFromEntity, callback));
  }

  checkRepositoryPermission(repositoryName: string, options, callback) {
    if (!callback && typeof (options) === 'function') {
      callback = options;
      options = null;
    }
    options = options || {};
    let operations = this._operations;
    let token = this._getToken();
    let github = operations.github;
    const organizationName = options.organizationName || this.organization.name;
    const parameters: ICheckRepositoryPermissionParameters = {
      id: this._id,
      owner: organizationName,
      repo: repositoryName,
    };
    const cacheOptions: ICacheOptions = {
      maxAgeSeconds: options.maxAgeSeconds || operations.defaults.teamRepositoryPermissionStaleSeconds,
    };
    if (options.backgroundRefresh !== undefined) {
      cacheOptions.backgroundRefresh = options.backgroundRefresh;
    }
    parameters.headers = {
      // Alternative response for additional information, including the permission level
      'Accept': 'application/vnd.github.v3.repository+json',
    };
    return github.call(token, 'orgs.checkTeamRepo', parameters, cacheOptions, (error, details) => {
      if (error) {
        return callback(error);
      }
      return callback(null, details && details.permissions ? details.permissions : null);
    });
  }

  getRepositories(options, callback) {
    if (!callback && typeof (options) === 'function') {
      callback = options;
      options = null;
    }
    options = options || {};

    let operations = this._operations;
    let token = this._getToken();
    let github = operations.github;

    const customTypeFilteringParameter = options.type;
    if (customTypeFilteringParameter && customTypeFilteringParameter !== 'sources') {
      return callback(new Error('Custom \'type\' parameter is specified, but at this time only \'sources\' is a valid enum value'));
    }

    let parameters: IGetRepositoriesParameters = {
      id: this._id,
      per_page: 100,
    };
    const caching: ICacheOptions = {
      maxAgeSeconds: options.maxAgeSeconds || operations.defaults.orgMembersStaleSeconds,
      backgroundRefresh: true,
    };
    if (options && options.backgroundRefresh === false) {
      caching.backgroundRefresh = false;
    }
    if (options.pageLimit) {
      parameters.pageLimit = options.pageLimit;
    }
    return github.collections.getTeamRepos(
      token,
      parameters,
      caching,
      (getTeamReposError, entities) => {
        const commonCallback = common.createInstancesCallback(this, repositoryFromEntity, callback);
        if (customTypeFilteringParameter !== 'sources') {
          return commonCallback(null, entities);
        }
        // Remove forks (non-sources)
        _.remove(entities, repo => { return repo.fork; });
        return commonCallback(null, entities);
      });
  }

  getOfficialMaintainers(callback) {
    this.getDetails(detailsError => {
      if (detailsError) {
        return callback(detailsError);
      }
      this.getMaintainers((getMaintainersError, maintainers) => {
        if (getMaintainersError) {
          return callback(getMaintainersError);
        }
        if (maintainers.length > 0) {
          return resolveDirectLinks(maintainers, callback);
        }
        this.organization.sudoersTeam.getMembers((getMembersError, members) => {
          if (getMembersError) {
            return callback(getMembersError);
          }
          return resolveDirectLinks(members, callback);
        });
      });
    });
  }

  member(id, optionalEntity?) {
    let entity = optionalEntity || {};
    if (!optionalEntity) {
      entity.id = id;
    }
    const member = new TeamMember(
      this,
      entity,
      this._getToken,
      this._operations);
    // CONSIDER: Cache any members in the local instance
    return member;
  }

  memberFromEntity(entity) {
    return this.member(entity.id, entity);
  }

  getApprovals(callback) {
    const operations = this._operations;
    const dc = operations.dataClient;
    dc.getPendingApprovals(this.id, function (error, pendingApprovals) {
      if (error) {
        return callback(wrapError(error, 'We were unable to retrieve the pending approvals list for this team. There may be a data store problem.'));
      }
      const pendingRequests = [];
      async.each(pendingApprovals, function (approval, cb) {
        if (approval.requested) {
          var asInt = parseInt(approval.requested, 10);
          approval.requestedTime = new Date(asInt);
        }
        pendingRequests.push(approval);
        return cb();
      }, error => {
        return callback(error, pendingRequests);
      });
    });
  }

  toSimpleJsonObject() {
    return {
      id: this.id,
      name: this.name,
      slug: this.slug,
      description: this.description,
      repos_count: this.repos_count,
      members_count: this.members_count,
      created_at: this.created_at,
      updated_at: this.updated_at,
    };
  }
}

function resolveDirectLinks(people, callback) {
  async.eachSeries(people, (member, next) => {
    return member.getMailAddress(next);
  }, error => {
    return callback(error ? error : null, error ? null : people);
  });
}

function repositoryFromEntity(entity) {
  // private, remapped "this"
  const instance = new TeamRepositoryPermission(
    this,
    entity,
    this._getToken,
    this._operations);
  return instance;
}

interface IGetMembersParameters {
  id: string;
  per_page: number;
  role?: string;
  pageLimit?: any;
}

interface ICheckRepositoryPermissionParameters {
  id: string;
  owner: string;
  repo: string;
  headers?: any;
}

interface IGetRepositoriesParameters {
  id: string;
  per_page: number;
  pageLimit?: any;
}
