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

import _ from 'lodash';

import { Organization } from './organization';
import { Operations } from './operations';
import { ICacheOptions, ICallback, IGetOwnerToken, ICacheOptionsPageLimiter, IPagedCacheOptions } from '../transitional';
import { TeamMember } from './teamMember';
import { TeamRepositoryPermission } from './teamRepositoryPermission';
import { IApprovalProvider } from '../entities/teamJoinApproval/approvalProvider';
import { TeamJoinApprovalEntity } from '../entities/teamJoinApproval/teamJoinApproval';
import { Repository } from './repository';

export enum GitHubRepositoryType {
  Sources = 'sources',
}

export interface ICheckRepositoryPermissionOptions extends ICacheOptions {
  organizationName?: string;
}

export interface IGetTeamRepositoriesOptions extends ICacheOptionsPageLimiter {
  type?: GitHubRepositoryType;
}

export interface ITeamMembershipRoleState {
  role?: GitHubTeamRole;
  state?: string;
}

export interface IIsMemberOptions extends ICacheOptions {
  role?: GitHubTeamRole;
}

export interface IGetMembersOptions extends ICacheOptionsPageLimiter {
  role?: GitHubTeamRole;
}

export enum GitHubTeamRole {
  Member = 'member',
  Maintainer = 'maintainer',
}

export interface IUpdateTeamMembershipOptions extends ICacheOptions {
  role?: GitHubTeamRole;
}

export class Team {
  public static PrimaryProperties = teamPrimaryProperties;

  private _organization: Organization;
  private _operations: Operations;
  private _getToken: IGetOwnerToken;

  private _id: string; // CONSIDER: GitHub API teams always are numbers, not strings

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

  constructor(organization: Organization, entity, getToken: IGetOwnerToken, operations: Operations) {
    if (!entity || !entity.id) {
      throw new Error('Team instantiation requires an incoming entity, or minimum-set entity containing an id property.');
    }
    this._organization = organization;
    // TODO: remove assignKnownFieldsPrefixed concept, use newer field definitions instead?
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

  async ensureName(): Promise<void> {
    if (this._name && this._slug) {
      return;
    }
    return await this.getDetails();
  }

  getDetails(options?: ICacheOptions): Promise<any> {
    return new Promise((resolve, reject) => {
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
        return reject(new Error('team.id required to retrieve team details'));
      }
      // If the details already have been loaded, move along without refreshing
      // CONSIDER: Either a time-based cache or ability to override the local cached behavior
      if (this._detailsEntity) {
        return resolve(this._detailsEntity);
      }
      const parameters = {
        team_id: id,
      };
      return operations.github.call(token, 'teams.get', parameters, cacheOptions, (error, entity) => {
        // CONSIDER: What if the team is gone? (404)
        if (error) {
          return reject(wrapError(error, `Could not get details about team ID ${this._id} in the GitHub organization ${this.organization.name}: ${error.message}`));
        }
        this._detailsEntity = entity;
        // TODO: move beyond setting with this approach
        common.assignKnownFieldsPrefixed(this, entity, 'team', teamPrimaryProperties, teamSecondaryProperties);
        return resolve(entity);
      });
    });
  }

  get isBroadAccessTeam(): boolean {
    const teams = this._organization.broadAccessTeams;
    // TODO: validating typing here - number or int?
    const asNumber = parseInt(this._id, 10);
    const res = teams.indexOf(asNumber);
    return res >= 0;
  }

  get isSystemTeam(): boolean {
    const systemTeams = this._organization.systemTeamIds;
    const res = systemTeams.indexOf(this._id);
    return res >= 0;
  }

  delete(): Promise<void> {
    return new Promise((resolve, reject) => {
      const operations = this._operations;
      const token = this._getToken();
      const github = operations.github;
      const parameters = {
        team_id: this._id,
      };
      github.post(token, 'teams.delete', parameters, error => {
        return error ? reject(error) : resolve();
      });
    });
  }

  edit(patch): Promise<void> {
    return new Promise((resolve, reject) => {
      const operations = this._operations;
      const token = this._getToken();
      const github = operations.github;
      const parameters = {
        team_id: this._id,
      };
      Object.assign(parameters, patch);
      delete parameters.team_id; // do not allow patch to have team_id
      delete parameters['id']; // // do not allow patch to have id
      github.post(token, 'teams.update', parameters, error => {
        return error ? reject(error) : resolve();
      });
    });
  }

  removeMembership(username: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const operations = this._operations;
      const token = this._getToken();
      const github = operations.github;
      const parameters = {
        team_id: this._id,
        username: username,
      };
      github.post(token, 'teams.removeMembership', parameters, error => {
        return error ? reject(error) : resolve();
      });
    });
  }

  addMembership(username: string, options?: IUpdateTeamMembershipOptions): Promise<void> {
    return new Promise((resolve, reject) => {
      const operations = this._operations;
      const token = this._getToken();
      const github = operations.github;
      options = options || {};
      const role = options.role || GitHubTeamRole.Member;
      const parameters = {
        team_id: this._id,
        username,
        role,
      };
      github.post(token, 'teams.addOrUpdateMembership', parameters, (error, response) => {
        return error ? reject(error) : resolve();
      });
    });
  }

  addMaintainer(username: string): Promise<void> {
    return this.addMembership(username, { role: GitHubTeamRole.Maintainer });
  }

  getMembership(username: string, options: ICacheOptions): Promise<any> {
    // TODO: proper return type
    return new Promise((resolve, reject) => {
      const operations = this._operations;
      const token = this._getToken();
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
        username,
      };
      // TODO: this should probably be a _post_ call and not _call_ as there is no cache with GitHub
      return operations.github.call(token, 'teams.getMembership', parameters, (error, result) => {
        if (error && error.status == /* loose */ 404) {
          result = false;
          error = null;
        }
        if (error) {
          let reason = error.message;
          if (error.status) {
            reason += ' ' + error.status;
          }
          const wrappedError = wrapError(error, `Trouble retrieving the membership for ${username} in team ${this._id}. ${reason}`);
          if (error.status) {
            wrappedError['code'] = error.status;
            wrappedError['status'] = error.status;
          }
          return reject(wrappedError);
        }
        return resolve(result);
      });
    });
  }

  async getMembershipEfficiently(username: string, options?: IIsMemberOptions): Promise<ITeamMembershipRoleState> {
    // Hybrid calls are used to check for membership. Since there is
    // often a relatively fresh cache available of all of the members
    // of a team, that data source is used first to avoid a unique
    // GitHub API call.
    const operations = this._operations;
    // A background cache is used that is slightly more aggressive
    // than the standard org members list to at least frontload a
    // refresh of the data.
    options = options || {};
    if (!options.maxAgeSeconds) {
      options.maxAgeSeconds = operations.defaults.orgMembershipStaleSeconds;
    }
    const isMaintainer = await this.isMaintainer(username, options);
    if (isMaintainer) {
      return { role: GitHubTeamRole.Maintainer };
    }
    const isMember = await this.isMember(username);
    if (isMember) {
      return { role: GitHubTeamRole.Member };
    }
    // Fallback to the standard membership lookup
    const membershipOptions = {
      maxAgeSeconds: operations.defaults.orgMembershipDirectStaleSeconds,
    };
    const result = await this.getMembership(username, membershipOptions);
    // TODO: used to respond with result.role, result.state. Is state used anywhere?
    if (!result || !result.role) {
      return result;
    }
    return { role: result.role, state: result.state };
  }

  async isMaintainer(username: string, options?: ICacheOptions): Promise<boolean> {
    const isOptions: IIsMemberOptions = Object.assign({}, options);
    isOptions.role = GitHubTeamRole.Maintainer;
    const maintainer = await this.isMember(username, isOptions) as GitHubTeamRole;
    return maintainer === GitHubTeamRole.Maintainer ? true : false;
  }

  async isMember(username: string, options?: IIsMemberOptions): Promise<GitHubTeamRole | boolean> {
    const operations = this._operations;
    options = options || {};
    if (!options.maxAgeSeconds) {
      options.maxAgeSeconds = operations.defaults.orgMembershipStaleSeconds;
    }
    const getMembersOptions: IGetMembersOptions = Object.assign({}, options);
    if (!options.role) {
      getMembersOptions.role = GitHubTeamRole.Member;
    }
    const members = await this.getMembers(getMembersOptions);
    const expected = username.toLowerCase();
    for (let i = 0; i < members.length; i++) {
      const member = members[i];
      if (member.login.toLowerCase() === expected) {
        return getMembersOptions.role;
      }
    }
    return false;
  }

  getMaintainers(options?: ICacheOptionsPageLimiter): Promise<TeamMember[]> {
    options = options || {};
    if (!options.maxAgeSeconds) {
      options.maxAgeSeconds = this._operations.defaults.teamMaintainersStaleSeconds;
    }
    const getMemberOptions: IGetMembersOptions = Object.assign({}, options || {});
    getMemberOptions.role = GitHubTeamRole.Maintainer;
    return this.getMembers(getMemberOptions);
  }

  getMembers(options?: IGetMembersOptions): Promise<TeamMember[]> {
    return new Promise((resolve, reject) => {
      options = options || {};
      const operations = this._operations;
      const token = this._getToken();
      const github = operations.github;
      const parameters: IGetMembersParameters = {
        team_id: this.id,
        per_page: operations.defaultPageSize,
      };
      const caching: IPagedCacheOptions = {
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
      // CONSIDER: Check the error object, if present, for error.status == /* loose */ 404 to alert/store telemetry on deleted teams
      return github.collections.getTeamMembers(
        token,
        parameters,
        caching,
        common.createPromisedInstances<TeamMember>(this, this.memberFromEntity, resolve, reject));
    });
  }

  checkRepositoryPermission(repositoryName: string, options?: ICheckRepositoryPermissionOptions): Promise<any> {
    return new Promise((resolve, reject) => {
      options = options || {};
      let operations = this._operations;
      let token = this._getToken();
      let github = operations.github;
      const organizationName = options.organizationName || this.organization.name;
      const parameters: ICheckRepositoryPermissionParameters = {
        team_id: this._id,
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
      return github.call(token, 'teams.checkManagesRepo', parameters, cacheOptions, (error, details) => {
        return error ? reject(error) : resolve(details && details.permissions ? details.permissions : null);
      });
    });
  }

  getRepositories(options?: IGetTeamRepositoriesOptions): Promise<Repository[]> {
    return new Promise((resolve, reject) => {
      options = options || {};
      const operations = this._operations;
      const token = this._getToken();
      const github = operations.github;
      // GitHub does not have a concept of filtering this out so we add it
      const customTypeFilteringParameter = options.type;
      if (customTypeFilteringParameter && customTypeFilteringParameter !== GitHubRepositoryType.Sources) {
        return reject(new Error(`Custom \'type\' parameter is specified, but at this time only \'sources\' is a valid enum value. Value: ${customTypeFilteringParameter}`));
      }
      const parameters: IGetRepositoriesParameters = {
        team_id: this._id,
        per_page: operations.defaultPageSize,
      };
      const caching: IPagedCacheOptions = {
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
          if (getTeamReposError) {
            return reject(getTeamReposError);
          }
          if (customTypeFilteringParameter === 'sources') {
          // Remove forks (non-sources)
          _.remove(entities, (repo: any) => { return repo.fork; });
          }
          return common.returnPromisedInstances<Repository>(this, repositoryFromEntity, resolve, reject, entities, getTeamReposError);
        });
      });
  }

  async getOfficialMaintainers(): Promise<TeamMember[]> {
    await this.getDetails();
    const maintainers = await this.getMaintainers();
    if (maintainers.length > 0) {
      return resolveDirectLinks(maintainers);
    }
    const members = await this.organization.sudoersTeam.getMembers();
    return resolveDirectLinks(members);
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

  async getApprovals(): Promise<TeamJoinApprovalEntity[]> {
    const operations = this._operations;
    const approvalProvider = operations.providers.approvalProvider as IApprovalProvider;
    if (!approvalProvider) {
      throw new Error('No approval provider instance available');
    }
    let pendingApprovals: TeamJoinApprovalEntity[] = null;
    try {
      pendingApprovals = await approvalProvider.queryPendingApprovalsForTeam(this.id);
    } catch(error) {
      throw wrapError(error, 'We were unable to retrieve the pending approvals list for this team. There may be a data store problem or temporary outage.');
    }
    return pendingApprovals;
  }

  toSimpleJsonObject() {
    return {
      id: typeof(this.id) === 'number' ? this.id : parseInt(this.id, 10),
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

async function resolveDirectLinks(people: TeamMember[]): Promise<TeamMember[]> {
  for (let i = 0; i < people.length; i++) {
    const member = people[i];
    await member.getMailAddress();
  }
  return people;
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
  team_id: string;
  per_page: number;
  role?: string;
  pageLimit?: any;
}

interface ICheckRepositoryPermissionParameters {
  team_id: string;
  owner: string;
  repo: string;
  headers?: any;
}

interface IGetRepositoriesParameters {
  team_id: string;
  per_page: number;
  pageLimit?: any;
}
