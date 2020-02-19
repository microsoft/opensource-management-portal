//
// Copyright (c) Microsoft.
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
import { ICacheOptions, ICallback, IGetOwnerToken, ICacheOptionsPageLimiter, IPagedCacheOptions, IGetAuthorizationHeader, IPurposefulGetAuthorizationHeader, IPagedCrossOrganizationCacheOptions } from '../transitional';
import { TeamMember } from './teamMember';
import { TeamRepositoryPermission } from './teamRepositoryPermission';
import { IApprovalProvider } from '../entities/teamJoinApproval/approvalProvider';
import { TeamJoinApprovalEntity } from '../entities/teamJoinApproval/teamJoinApproval';
import { Repository } from './repository';
import { AppPurpose } from '../github';

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

export interface ICrossOrganizationTeamMembership extends IPagedCrossOrganizationCacheOptions {
  role?: GitHubTeamRole;
}

export interface ITeamMembershipOptions {
  role?: GitHubTeamRole;
}

export interface IUpdateTeamMembershipOptions extends ICacheOptions {
  role?: GitHubTeamRole;
}

export class Team {
  public static PrimaryProperties = teamPrimaryProperties;

  private _organization: Organization;
  private _operations: Operations;
  private _getAuthorizationHeader: IPurposefulGetAuthorizationHeader;

  private _id: number;

  private _slug?: string;
  private _name?: string;

  private _created_at?: any;
  private _updated_at?: any;

  private _description: string;

  private _repos_count: any;
  private _members_count: any;

  private _detailsEntity?: any;

  get id(): number {
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

  constructor(organization: Organization, entity, getAuthorizationHeader: IPurposefulGetAuthorizationHeader, operations: Operations) {
    if (!entity || !entity.id) {
      throw new Error('Team instantiation requires an incoming entity, or minimum-set entity containing an id property.');
    }
    if (typeof(entity.id) !== 'number') {
      throw new Error('Team constructor entity.id must be a Number');
    }
    this._organization = organization;
    // TODO: remove assignKnownFieldsPrefixed concept, use newer field definitions instead?
    common.assignKnownFieldsPrefixed(this, entity, 'team', teamPrimaryProperties, teamSecondaryProperties);
    this._getAuthorizationHeader = getAuthorizationHeader;
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

  async isDeleted(options?: ICacheOptions): Promise<boolean> {
    try {
      await this.getDetails(options);
    } catch (maybeDeletedError) {
      if (maybeDeletedError && maybeDeletedError.status && maybeDeletedError.status === 404) {
        return true;
      }
    }
    return false;
  }

  async getDetails(options?: ICacheOptions): Promise<any> {
    options = options || {};
    const operations = this._operations;
    const cacheOptions = {
      maxAgeSeconds: options.maxAgeSeconds || operations.defaults.orgTeamDetailsStaleSeconds,
      backgroundRefresh: false,
    };
    if (options.backgroundRefresh !== undefined) {
      cacheOptions.backgroundRefresh = options.backgroundRefresh;
    }
    const id = this._id;
    if (!id) {
      throw new Error('team.id required to retrieve team details');
    }
    // If the details already have been loaded, move along without refreshing
    // CONSIDER: Either a time-based cache or ability to override the local cached behavior
    if (this._detailsEntity) {
      return this._detailsEntity;
    }
    const parameters = {
      team_id: id,
    };
    try {
      const entity = await operations.github.call(this.authorize(AppPurpose.Data), 'teams.get', parameters, cacheOptions);
      this._detailsEntity = entity;
      // TODO: move beyond setting with this approach
      common.assignKnownFieldsPrefixed(this, entity, 'team', teamPrimaryProperties, teamSecondaryProperties);
      return entity;
    } catch (error) {
      if (error.status && error.status === 404) {
        error = new Error(`The GitHub team ID ${id} could not be found or has been deleted`);
        error.status = 404;
        throw error;
      }
      throw wrapError(error, `Could not get details about team ID ${this._id} in the GitHub organization ${this.organization.name}: ${error.message}`);
    }
  }

  get isBroadAccessTeam(): boolean {
    const teams = this._organization.broadAccessTeams;
    // TODO: validating typing here - number or int?
    if (typeof(this._id) !== 'number') {
      throw new Error('Team.id must be a number');
    }
    const res = teams.indexOf(this._id);
    return res >= 0;
  }

  get isSystemTeam(): boolean {
    const systemTeams = this._organization.systemTeamIds;
    const res = systemTeams.indexOf(this._id);
    return res >= 0;
  }

  delete(): Promise<void> {
    const operations = this._operations;
    const github = operations.github;
    const parameters = {
      team_id: this._id,
    };
    return github.post(this.authorize(AppPurpose.Operations), 'teams.delete', parameters);
  }

  edit(patch: unknown): Promise<void> {
    const operations = this._operations;
    const github = operations.github;
    const parameters = {
      team_id: this._id,
    };
    Object.assign(parameters, patch);
    delete parameters.team_id; // do not allow patch to have team_id
    delete parameters['id']; // // do not allow patch to have id
    return github.post(this.authorize(AppPurpose.Operations), 'teams.update', parameters);
  }

  removeMembership(username: string): Promise<void> {
    const operations = this._operations;
    const github = operations.github;
    const parameters = {
      team_id: this._id,
      username: username,
    };
    return github.post(this.authorize(AppPurpose.Operations), 'teams.removeMembership', parameters);
  }

  addMembership(username: string, options?: IUpdateTeamMembershipOptions): Promise<void> {
    const operations = this._operations;
    const github = operations.github;
    options = options || {};
    const role = options.role || GitHubTeamRole.Member;
    const parameters = {
      team_id: this._id,
      username,
      role,
    };
    return github.post(this.authorize(AppPurpose.CustomerFacing), 'teams.addOrUpdateMembership', parameters);
  }

  addMaintainer(username: string): Promise<void> {
    return this.addMembership(username, { role: GitHubTeamRole.Maintainer });
  }

  async getMembership(username: string, options: ICacheOptions): Promise<any> {
    // TODO: proper return type for the GitHub entity. is it 'role' or?
    const operations = this._operations;
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
    try {
      const result = await operations.github.post(this.authorize(AppPurpose.CustomerFacing), 'teams.getMembership', parameters);
      return result;
    } catch (error) {
      if (error.status == /* loose */ 404) {
        return false;
      }
      let reason = error.message;
      if (error.status) {
        reason += ' ' + error.status;
      }
      const wrappedError = wrapError(error, `Trouble retrieving the membership for ${username} in team ${this._id}. ${reason}`);
      if (error.status) {
        wrappedError['status'] = error.status;
      }
      throw wrappedError;
    }
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

  async getMembers(options?: IGetMembersOptions): Promise<TeamMember[]> {
    options = options || {};
    const operations = this._operations;
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
    const teamMembersEntities = await github.collections.getTeamMembers(this.authorize(AppPurpose.Data), parameters, caching);
    const teamMembers = common.createInstances<TeamMember>(this, this.memberFromEntity, teamMembersEntities);
    return teamMembers;
  }

  async getRepositories(options?: IGetTeamRepositoriesOptions): Promise<Repository[]> {
    options = options || {};
    const operations = this._operations;
    const github = operations.github;
    // GitHub does not have a concept of filtering this out so we add it
    const customTypeFilteringParameter = options.type;
    if (customTypeFilteringParameter && customTypeFilteringParameter !== GitHubRepositoryType.Sources) {
      throw new Error(`Custom \'type\' parameter is specified, but at this time only \'sources\' is a valid enum value. Value: ${customTypeFilteringParameter}`);
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
    const entities = await github.collections.getTeamRepos(this.authorize(AppPurpose.Data), parameters, caching);
    if (customTypeFilteringParameter === 'sources') {
      // Remove forks (non-sources)
      _.remove(entities, (repo: any) => { return repo.fork; });
    }
    return common.createInstances<Repository>(this, repositoryFromEntity, entities);
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
      pendingApprovals = await approvalProvider.queryPendingApprovalsForTeam(this.id.toString());
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

  private authorize(purpose: AppPurpose): IGetAuthorizationHeader | string {
    const getAuthorizationHeader = this._getAuthorizationHeader.bind(this, purpose) as IGetAuthorizationHeader;
    return getAuthorizationHeader;
  }

  // COMMENTED OUT: this interfaced is used by the commented out function below
  // interface ICheckRepositoryPermissionParameters {
  //   team_id: string;
  //   owner: string;
  //   repo: string;
  //   headers?: any;
  // }
  // COMMENTED OUT: this function is no longer used
  // async checkRepositoryPermission(repositoryName: string, options?: ICheckRepositoryPermissionOptions): Promise<any> {
  //   options = options || {};
  //   let operations = this._operations;
  //   let github = operations.github;
  //   const organizationName = options.organizationName || this.organization.name;
  //   const parameters: ICheckRepositoryPermissionParameters = {
  //     team_id: this._id,
  //     owner: organizationName,
  //     repo: repositoryName,
  //   };
  //   const cacheOptions: ICacheOptions = {
  //     maxAgeSeconds: options.maxAgeSeconds || operations.defaults.teamRepositoryPermissionStaleSeconds,
  //   };
  //   if (options.backgroundRefresh !== undefined) {
  //     cacheOptions.backgroundRefresh = options.backgroundRefresh;
  //   }
  //   parameters.headers = {
  //     // Alternative response for additional information, including the permission level
  //     'Accept': 'application/vnd.github.v3.repository+json',
  //   };
  //   const details = await github.call(this.authorize(AppPurpose.Data), 'teams.checkManagesRepo', parameters, cacheOptions);
  //   return details && details.permissions ? details.permissions : null;
  // }
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
    this._operations);
  return instance;
}

interface IGetMembersParameters {
  team_id: number;
  per_page: number;
  role?: string;
  pageLimit?: any;
}

interface IGetRepositoriesParameters {
  team_id: number;
  per_page: number;
  pageLimit?: any;
}
