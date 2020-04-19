//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { wrapError, asNumber } from '../utils';
import { Operations } from './operations';
import { Organization } from './organization';
import { ICacheOptions, IPagedCacheOptions, IGetAuthorizationHeader, IPurposefulGetAuthorizationHeader, ErrorHelper } from '../transitional';
import * as common from './common';
import { RepositoryPermission } from './repositoryPermission';
import { Collaborator } from './collaborator';
import { TeamPermission } from './teamPermission';
import { RepositoryMetadataEntity, GitHubRepositoryPermission } from '../entities/repositoryMetadata/repositoryMetadata';
import moment from 'moment';
import { AppPurpose } from '../github';

export interface IGitHubCollaboratorInvitation {
  id: string;
}

export interface IAlternateTokenRequiredOptions extends ICacheOptions {
  alternateToken: string;
}

export interface IGetBranchesOptions extends ICacheOptions {
  protected?: boolean;
}

export interface IGetContentOptions extends ICacheOptions {
  branch?: string;
  tag?: string;
  ref?: string;
}

export enum GitHubCollaboratorAffiliationQuery {
  All = 'all',
  Outside = 'outside',
  Direct = 'direct',
}

export enum GitHubCollaboratorType {
  Outside = 'outside',
  Direct = 'direct',
}

export interface IGetCollaboratorsOptions extends IPagedCacheOptions {
  affiliation?: GitHubCollaboratorAffiliationQuery;
}

export interface ICreateWebhookOptions {
  name?: string;
  active?: boolean;
  config?: {
    url?: string;
    content_type?: string;
    secret?: string;
    insecure_ssl?: string;
  };
  url?: string;
  events?: string[];
}

interface IGitHubGetFileParameters {
  owner: string;
  repo: string;
  path: string;
  branch?: string;

  alternateToken?: string;
}

interface IGitHubFileContents {
  type: string;
  encoding: 'base64';
  size: number;
  name: string;
  path: string;
  content: string;
  sha: string;
  url: string;
  git_url: string;
  html_url: string;
  download_url: string;
  _links: {
    git: string;
    self: string;
    html: string;
  }
}

interface ICreateFileParameters {
  owner: string;
  repo: string;
  path: string;
  message: string;
  content: string;
  branch?: string;
  committer?: any;
  sha?: string;

  alternateToken?: string;
}

interface IGitHubGetFileOptions {
  branch?: string;
}

interface ICreateFileOptions {
  branch?: string;
  committer?: any;
  alternateToken?: string;
  sha?: string;
}

interface IGetBranchesParameters {
  owner: string;
  repo: string;
  per_page: number;
  protected?: any;
}

interface IRepositoryMoments {
  created?: moment.Moment;
  updated?: moment.Moment;
  pushed?: moment.Moment;
}

interface IRepositoryMomentsAgo {
  created?: string;
  updated?: string;
  pushed?: string;
}

const repoPrimaryProperties = [
  'id',
  'name',
  'full_name',
  'private',
  'html_url',
  'description',
  'fork',
  'url',
  'created_at',
  'updated_at',
  'pushed_at',
  'git_url',
  'homepage',
  'size',
  'stargazers_count',
  'watchers_count',
  'language',
  'has_issues',
  'has_wiki',
  'has_pages',
  'forks_count',
  'open_issues_count',
  'forks',
  'open_issues',
  'watchers',
  'license',
  'default_branch',
];

export class Repository {
  public static PrimaryProperties = repoPrimaryProperties;
  private _entity: any;
  private _baseUrl: string;

  private _getAuthorizationHeader: IPurposefulGetAuthorizationHeader;
  private _operations: Operations;

  private _organization: Organization;

  private _name: string;

  private _moments: IRepositoryMoments;

  getEntity(): any { return this._entity; }

  get id(): number { return this._entity ? this._entity.id : null; }
  get name(): string { return this._entity ? this._entity.name : this._name; }
  get full_name(): string { return this._entity ? this._entity.full_name : null; }
  get private(): boolean { return this._entity ? this._entity.private : false; }
  get html_url(): string { return this._entity ? this._entity.html_url : null; }
  get description(): string { return this._entity ? this._entity.description : null; }
  get fork(): boolean { return this._entity ? this._entity.fork : null; }
  get url(): string { return this._entity ? this._entity.url : null; }
  get created_at(): Date { return this._entity ? this._entity.created_at : null; }
  get updated_at(): Date { return this._entity ? this._entity.updated_at : null; }
  get pushed_at(): Date { return this._entity ? this._entity.pushed_at : null; }
  get git_url(): string { return this._entity ? this._entity.git_url : null; }
  get homepage(): string { return this._entity ? this._entity.homepage : null; }
  get size(): any { return this._entity ? this._entity.size : null; }
  get stargazers_count(): any { return this._entity ? this._entity.stargazers_count : null; }
  get watchers_count(): any { return this._entity ? this._entity.watchers_count : null; }
  get language(): string { return this._entity ? this._entity.language : null; }
  get has_issues(): boolean { return this._entity ? this._entity.has_issues : null; }
  get has_wiki(): boolean { return this._entity ? this._entity.has_wiki : null; }
  get has_pages(): boolean { return this._entity ? this._entity.has_pages : null; }
  get forks_count(): any { return this._entity ? this._entity.forks_count : null; }
  get open_issues_count(): any { return this._entity ? this._entity.open_issues_count : null; }
  get forks(): any { return this._entity ? this._entity.forks : null; }
  get open_issues(): any { return this._entity ? this._entity.open_issues : null; }
  get watchers(): any { return this._entity ? this._entity.watchers : null; }
  get license(): any { return this._entity ? this._entity.license : null; }
  get default_branch(): any { return this._entity ? this._entity.default_branch : null; }
  get clone_url(): any { return this._entity ? this._entity.clone_url : null; }
  get ssh_url(): any { return this._entity ? this._entity.ssh_url : null; }
  get parent(): any { return this._entity ? this._entity.parent : null; }

  get organization(): Organization {
    return this._organization;
  }

  get baseUrl(): string {
    return this._baseUrl;
  }

  get absoluteBaseUrl(): string {
    return this.organization.absoluteBaseUrl + 'repos/' + this.name + '/';
  }

  constructor(organization: Organization, entity: any, getAuthorizationHeader: IPurposefulGetAuthorizationHeader, operations: Operations) {
    this._organization = organization;
    this._entity = entity;
    this._baseUrl = organization.baseUrl + 'repos/' + this.name + '/';
    this._getAuthorizationHeader = getAuthorizationHeader;
    this._operations = operations;
  }

  get moment(): IRepositoryMoments {
    if (!this._moments) {
      this._moments = {
        updated: this.updated_at ? moment(this.updated_at) : undefined,
        pushed: this.pushed_at ? moment(this.pushed_at) : undefined,
        created: this.created_at ? moment(this.created_at) : undefined,
      };
    }
    return this._moments;
  }

  get momentDisplay(): IRepositoryMomentsAgo {
    const moments = this.moment;
    return {
      updated: moments.updated ? moments.updated.fromNow() : undefined,
      created: moments.created ? moments.created.fromNow() : undefined,
      pushed: moments.pushed ? moments.pushed.fromNow() : undefined,
    };
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
    if (this.id && !this.name) {
      try {
        const lookupById = await this.organization.getRepositoryById(this.id);
        this._entity = lookupById.getEntity();
        this._name = this._entity.name;
      } catch (getByIdError) {
        throw getByIdError;
      }
    }
    const parameters = {
      owner: this.organization.name,
      repo: this.name,
    };
    const cacheOptions: ICacheOptions = {
      maxAgeSeconds: options.maxAgeSeconds || operations.defaults.orgRepoDetailsStaleSeconds,
    };
    if (options.backgroundRefresh !== undefined) {
      cacheOptions.backgroundRefresh = options.backgroundRefresh;
    }
    try {
      const entity = await operations.github.call(this.authorize(AppPurpose.Data), 'repos.get', parameters, cacheOptions);
      this._entity = entity;
      return entity;
    } catch (error) {
      const notFound = error.status && error.status == /* loose */ 404;
      error = wrapError(error, notFound ? 'The repo could not be found.' : 'Could not get details about the repo.', notFound);
      if (notFound) {
        error.status = 404;
      }
      throw error;
    }
  }

  async getRepositoryMetadata(): Promise<RepositoryMetadataEntity> {
    const repositoryMetadataProvider = this._operations.providers.repositoryMetadataProvider;
    try {
      return await repositoryMetadataProvider.getRepositoryMetadata(this.id.toString());
    } catch (getMetadataError) {
      return null;
    }
  }

  async getBranches(cacheOptions: IGetBranchesOptions): Promise<any> {
    cacheOptions = cacheOptions || {};
    const operations = this._operations;
    const github = operations.github;
    const parameters: IGetBranchesParameters = {
      owner: this.organization.name,
      repo: this.name,
      per_page: operations.defaultPageSize,
    };
    if (cacheOptions.protected !== undefined) {
      parameters.protected = cacheOptions.protected;
    }
    delete cacheOptions.protected;
    if (!cacheOptions.maxAgeSeconds) {
      cacheOptions.maxAgeSeconds = operations.defaults.repoBranchesStaleSeconds;
    }
    if (cacheOptions.backgroundRefresh === undefined) {
      cacheOptions.backgroundRefresh = true;
    }
    return github.collections.getRepoBranches(this.authorize(AppPurpose.Data), parameters, cacheOptions);
  }

  async getContent(path: string, options?: IGetContentOptions): Promise<any> {
    options = options || {};
    const ref = options.branch || options.tag || options.ref || 'master';
    const parameters = {
      owner: this.organization.name,
      repo: this.name,
      path: path,
      ref: ref,
    };
    const operations = this._operations
    return operations.github.call(this.authorize(AppPurpose.Data), 'repos.getContents', parameters);
  }

  async getPages(options?: ICacheOptions): Promise<any> {
    options = options || {};
    const operations = this._operations;
    const parameters = {
      owner: this.organization.name,
      repo: this.name,
    };
    const cacheOptions: ICacheOptions = {
      maxAgeSeconds: options.maxAgeSeconds || operations.defaults.orgRepoDetailsStaleSeconds,
    };
    if (options.backgroundRefresh !== undefined) {
      cacheOptions.backgroundRefresh = options.backgroundRefresh;
    }
    try {
      const token = this._operations.authorizeCentralOperationsToken();
      return await operations.github.call(token, 'repos.getPages', parameters, cacheOptions);
    } catch (error) {
      const notFound = error.status && error.status == /* loose */ 404;
      error = wrapError(error, notFound ? 'The repo is not configured for pages.' : 'Could not get details about the repo pages configuration.', notFound);
      if (notFound) {
        error.status = 404;
      }
      throw error;
    }
  }

  async checkCollaborator(username: string, cacheOptions?: ICacheOptions): Promise<boolean> {
    cacheOptions = cacheOptions || {};
    const operations = this._operations;
    const parameters = {
      owner: this.organization.name,
      repo: this.name,
      username,

      allowEmptyResponse: true,
    };
    if (!cacheOptions.maxAgeSeconds) {
      cacheOptions.maxAgeSeconds = operations.defaults.orgRepoTeamsStaleSeconds;
    }
    if (cacheOptions.backgroundRefresh === undefined) {
      cacheOptions.backgroundRefresh = true;
    }
    try {
      const ok = await operations.github.post(this.authorize(AppPurpose.Data), 'repos.checkCollaborator', parameters);
      return true;
    } catch (error) {
      if (error && error.status == /* loose */ 404) {
        return false;
      }
      throw wrapError(error, `Could not verify the collaborator level for user ${username} in the repo ${this.organization.name}/${this.name}`);
    }
  }

  async getCollaborator(username: string, cacheOptions?: ICacheOptions): Promise<RepositoryPermission> {
    // This call is used in customer-facing sites by permissions middleware
    cacheOptions = cacheOptions || {};
    const operations = this._operations;
    const github = operations.github;
    const parameters = {
      owner: this.organization.name,
      repo: this.name,
      username: username,
    };
    if (!cacheOptions.maxAgeSeconds) {
      //cacheOptions.maxAgeSeconds = operations.defaults.orgRepoCollaboratorStaleSeconds;
    }
    if (cacheOptions.backgroundRefresh === undefined) {
      //cacheOptions.backgroundRefresh = true;
    }
    Object.assign(parameters, cacheOptions);
    const userPermissionLevel = await github.call(this.authorize(AppPurpose.CustomerFacing), 'repos.getCollaboratorPermissionLevel', parameters);
    return new RepositoryPermission(userPermissionLevel);
  }

  async getCollaborators(cacheOptions?: IGetCollaboratorsOptions): Promise<Collaborator[]> {
    cacheOptions = cacheOptions || {};
    const operations = this._operations;
    const github = operations.github;
    const parameters = {
      owner: this.organization.name,
      repo: this.name,
      per_page: operations.defaultPageSize,
      affiliation: cacheOptions.affiliation || GitHubCollaboratorAffiliationQuery.All,
    };
    delete cacheOptions.affiliation;
    if (!cacheOptions.maxAgeSeconds) {
      cacheOptions.maxAgeSeconds = operations.defaults.orgRepoCollaboratorsStaleSeconds;
    }
    if (cacheOptions.backgroundRefresh === undefined) {
      cacheOptions.backgroundRefresh = true;
    }
    const collaboratorEntities = await github.collections.getRepoCollaborators(this.authorize(AppPurpose.Data), parameters, cacheOptions);
    const collaborators = common.createInstances<Collaborator>(this, collaboratorPermissionFromEntity, collaboratorEntities);
    return collaborators;
  }

  async addCollaborator(username: string, permission: GitHubRepositoryPermission): Promise<IGitHubCollaboratorInvitation> {
    // BREAKING CHANGE in the GitHub API: as of August 2017, this is "inviteCollaborator', it does not automatically add
    const github = this._operations.github;
    const parameters = {
      owner: this.organization.name,
      repo: this.name,
      username: username,
      permission: permission,
    };
    // CONSIDER: If status code 404 on return, the username does not exist on GitHub as entered
    const response = await github.post(this.authorize(AppPurpose.Operations), 'repos.addCollaborator', parameters);
    return response as IGitHubCollaboratorInvitation;
  }

  async acceptCollaborationInvite(invitationId: string, options: IAlternateTokenRequiredOptions): Promise<any> {
    // This could go in Account _or_ here in Repository
    if (!options || !options.alternateToken) {
      throw new Error('acceptCollaborationInvite requires options.alternateToken');
    }
    const alternateTokenHeader = `token ${options.alternateToken}`;
    const parameters = {
      invitation_id: invitationId,
    };
    return this._operations.github.post(alternateTokenHeader, 'repos.acceptInvitation', parameters);
  }

  removeCollaborator(username: string): Promise<any> {
    const parameters = {
      owner: this.organization.name,
      repo: this.name,
      username: username,
    };
    return this._operations.github.post(this.authorize(AppPurpose.Operations), 'repos.removeCollaborator', parameters);
  }

  delete(): Promise<void> {
    const parameters = {
      owner: this.organization.name,
      repo: this.name,
    };
    return this._operations.github.post(this.authorize(AppPurpose.Operations), 'repos.delete', parameters);
  }

  createFile(path: string, base64Content: string, commitMessage: string, options?: ICreateFileOptions): Promise<any> {
    const parameters: ICreateFileParameters = Object.assign({
      owner: this.organization.name,
      repo: this.name,
      path,
      message: commitMessage,
      content: base64Content,
    }, options);
    if (options && options.sha) {
      parameters.sha = options.sha;
    }
    if (options && options.branch) {
      parameters.branch = options.branch;
    }
    if (options && options.committer) {
      parameters.committer = options.committer;
    }
    const alternateHeader = options.alternateToken ? `token ${options.alternateToken}` : null;
    return this._operations.github.post(alternateHeader || this.authorize(AppPurpose.Operations), 'repos.createOrUpdateFile', parameters);
  }

  getFile(path: string, options?: IGitHubGetFileOptions): Promise<IGitHubFileContents> {
    const parameters: IGitHubGetFileParameters = Object.assign({
      owner: this.organization.name,
      repo: this.name,
      path,
    }, options);
    if (options && options.branch) {
      parameters.branch = options.branch;
    }
    // const alternateHeader = options.alternateToken ? `token ${options.alternateToken}` : null;
    return this._operations.github.post(this.authorize(AppPurpose.Operations), 'repos.getContents', parameters);
  }

  getFiles(path: string, options?: IGitHubGetFileOptions): Promise<IGitHubFileContents[]> {
    const parameters: IGitHubGetFileParameters = Object.assign({
      owner: this.organization.name,
      repo: this.name,
      path,
    }, options);
    if (options.branch) {
      parameters.branch = options.branch;
    }
    // const alternateHeader = options.alternateToken ? `token ${options.alternateToken}` : null;
    return this._operations.github.post(this.authorize(AppPurpose.Operations), 'repos.getContents', parameters);
  }

  async setTeamPermission(teamId: number, newPermission: GitHubRepositoryPermission): Promise<any> {
    const team = this.organization.team(teamId);
    // CONSIDER: note the performance penalty on the slug resolution; the alternate path has not been working for GitHub Apps
    await team.getDetails();
    const options = {
      org: this.organization.name,
      team_slug: team.slug,
      owner: this.organization.name,
      repo: this.name,
      permission: newPermission,
    };
    // alternate version of: 'teams.addOrUpdateRepoInOrg': 'PUT /organizations/:org_id/team/:team_id/repos/:owner/:repo'
    const result = await this._operations.github.post(this.authorize(AppPurpose.Operations), 'teams.addOrUpdateRepoInOrg', options);
    return result;
  }

  removeTeamPermission(teamId: number): Promise<any> {
    const options = {
      org_id: this.organization.id.toString(),
      team_id: teamId,
      owner: this.organization.name,
      repo: this.name,
    };
    // alternate version of: 'teams.removeRepoInOrg'
    return this._operations.github.requestAsPost(this.authorize(AppPurpose.Operations), 'DELETE /organizations/:org_id/team/:team_id/repos/:owner/:repo', options);
  }

  async getWebhooks(options?: ICacheOptions): Promise<any> {
    options = options || {};
    const operations = this._operations
    const parameters = {
      owner: this.organization.name,
      repo: this.name,
    };
    const cacheOptions: ICacheOptions = {
      maxAgeSeconds: options.maxAgeSeconds || operations.defaults.orgRepoWebhooksStaleSeconds,
    };
    if (options.backgroundRefresh !== undefined) {
      cacheOptions.backgroundRefresh = options.backgroundRefresh;
    }
    return operations.github.call(this.authorize(AppPurpose.Data), 'repos.listHooks', parameters, cacheOptions);
  }

  deleteWebhook(webhookId: string): Promise<any> {
    const parameters = {
      owner: this.organization.name,
      repo: this.name,
      id: webhookId,
    };
    return this._operations.github.post(this.authorize(AppPurpose.Operations), 'repos.deleteHook', parameters);
  }

  createWebhook(options: ICreateWebhookOptions): Promise<any> {
    delete options['owner'];
    delete options['repo'];
    const parameters = Object.assign({
      owner: this.organization.name,
      repo: this.name,
    }, options);
    // Smart defaults: create an active JSON web hook to the 'url' option
    if (!options.name) {
      parameters.name = 'web';
    }
    if (options.active === undefined) {
      parameters.active = true;
    }
    if (options.url && !options.config) {
      delete parameters.url;
      parameters.config = {
        url: options.url,
        content_type: 'json',
      };
    }
    return this._operations.github.post(this.authorize(AppPurpose.Operations), 'repos.createHook', parameters);
  }

  async editPublicPrivate(options): Promise<void> {
    options = options || {};
    if (options.private !== true && options.private !== false) {
      throw new Error('editPublicPrivate.options requires private to be set to true or false');
    }
    const parameters = Object.assign({
      owner: this.organization.name,
      repo: this.name,
    }, {
      private: options.private,
    });
    // BUG: GitHub Apps do not work with locking down no repository permissions as documented here: https://github.community/t5/GitHub-API-Development-and/GitHub-App-cannot-patch-repo-visibility-in-org-with-repo/m-p/33448#M3150
    const token = this._operations.authorizeCentralOperationsToken();
    return this._operations.github.post(token, 'repos.update', parameters);
    // return this._operations.github.post(this.authorize(AppPurpose.Operations), 'repos.update', parameters);
  }

  async getTeamPermissions(cacheOptions?: IPagedCacheOptions): Promise<TeamPermission[]> {
    cacheOptions = cacheOptions || {};
    const operations = this._operations;
    const github = operations.github;
    const parameters = {
      owner: this.organization.name,
      repo: this.name,
      per_page: operations.defaultPageSize,
    };
    if (!cacheOptions.maxAgeSeconds) {
      cacheOptions.maxAgeSeconds = operations.defaults.orgRepoTeamsStaleSeconds;
    }
    if (cacheOptions.backgroundRefresh === undefined) {
      cacheOptions.backgroundRefresh = true;
    }
    const permissionEntities = await github.collections.getRepoTeams(this.authorize(AppPurpose.Data), parameters, cacheOptions);
    const teamPermissions = common.createInstances<TeamPermission>(this, teamPermissionFromEntity, permissionEntities);
    return teamPermissions;
  }

  async checkTeamManages(teamId: string, cacheOptions?: ICacheOptions): Promise<boolean> {
    cacheOptions = cacheOptions || {};
    const operations = this._operations;
    const parameters = {
      owner: this.organization.name,
      org_id: this.organization.id.toString(),
      repo: this.name,
      team_id: teamId,

      allowEmptyResponse: true,
    };
    if (!cacheOptions.maxAgeSeconds) {
      cacheOptions.maxAgeSeconds = operations.defaults.orgRepoTeamsStaleSeconds;
    }
    if (cacheOptions.backgroundRefresh === undefined) {
      cacheOptions.backgroundRefresh = true;
    }
    try {
      // this is the alternate form of 'teams.checkManagesRepoInOrg'
      await operations.github.requestAsPost(this.authorize(AppPurpose.Data), 'GET /organizations/:org_id/team/:team_id/repos/:owner/:repo', parameters);
      return true;
   } catch (error) {
      if (error && error.status == /* loose */ 404) {
        return false;
      }
      throw wrapError(error, `Could not verify the team management permissions of the repo ${this.organization.name}/${this.name} for team ${teamId}`);
    }
  }

  private authorize(purpose: AppPurpose): IGetAuthorizationHeader | string {
    const getAuthorizationHeader = this._getAuthorizationHeader.bind(this, purpose) as IGetAuthorizationHeader;
    return getAuthorizationHeader;
  }
}

function teamPermissionFromEntity(entity) {
  // 'this' is bound for this function to be a private method
  const operations = this._operations;
  const permission = new TeamPermission(this.organization, entity, operations);
  return permission;
}

function collaboratorPermissionFromEntity(entity) {
  // 'this' is bound for this function to be a private method
  const permission = new Collaborator(entity);
  return permission;
}
