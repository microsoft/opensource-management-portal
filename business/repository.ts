//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

import { wrapError } from '../utils';
import { Operations } from './operations';
import { Organization } from './organization';
import { ICacheOptions, IGetOwnerToken, IPagedCacheOptions, IGetAuthorizationHeader, IPurposefulGetAuthorizationHeader } from '../transitional';
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

interface ICreateFileParameters {
  owner: string;
  repo: string;
  path: string;
  message: string;
  content: string;
  branch?: string;
  committer?: any;

  alternateToken?: string;
}

interface ICreateFileOptions {
  branch?: string;
  committer?: any;
  alternateToken?: string;
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

const repoSecondaryProperties = [
  'owner',
  'permissions',
  'forks_url',
  'keys_url',
  'clone_url',
  'collaborators_url',
  'teams_url',
  'hooks_url',
  'issue_events_url',
  'events_url',
  'assignees_url',
  'branches_url',
  'tags_url',
  'blobs_url',
  'git_tags_url',
  'git_refs_url',
  'has_downloads',
  'ssh_url',
  'trees_url',
  'statuses_url',
  'languages_url',
  'stargazers_url',
  'contributors_url',
  'subscribers_url',
  'subscription_url',
  'commits_url',
  'git_commits_url',
  'comments_url',
  'issue_comment_url',
  'contents_url',
  'compare_url',
  'merges_url',
  'archive_url',
  'downloads_url',
  'issues_url',
  'pulls_url',
  'milestones_url',
  'notifications_url',
  'labels_url',
  'releases_url',
  'svn_url',
  'mirror_url',
  'organization',
  'network_count',
  'subscribers_count',
  'deployments_url',
];

export class Repository {
  public static PrimaryProperties = repoPrimaryProperties;

  private _baseUrl: string;

  private _getAuthorizationHeader: IPurposefulGetAuthorizationHeader;
  private _operations: Operations;

  private _organization: Organization;

  private _id: number;
  private _name: string;
  private _full_name: string;
  private _private: boolean;
  private _html_url: string;
  private _description: string;
  private _fork: any;
  private _url: string;
  private _created_at: Date;
  private _updated_at: Date;
  private _pushed_at: Date;
  private _git_url: string;
  private _homepage: string;
  private _size: any;
  private _stargazers_count: any;
  private _watchers_count: any;
  private _language: any;
  private _has_issues: boolean;
  private _has_wiki: boolean;
  private _has_pages: boolean;
  private _forks_count: any;
  private _open_issues_count: any;
  private _forks: any;
  private _open_issues: any;
  private _watchers: any;
  private _license: any;
  private _default_branch: any;

  private _moments: IRepositoryMoments;

  get id(): number { return this._id; }
  get name(): string { return this._name; }
  get full_name(): string { return this._full_name; }
  get private(): boolean { return this._private; }
  get html_url(): string { return this._html_url; }
  get description(): string { return this._description; }
  get fork(): any { return this._fork; }
  get url(): string { return this._url; }
  get created_at(): Date { return this._created_at; }
  get updated_at(): Date { return this._updated_at; }
  get pushed_at(): Date { return this._pushed_at; }
  get git_url(): string { return this._git_url; }
  get homepage(): string { return this._homepage; }
  get size(): any { return this._size; }
  get stargazers_count(): any { return this._stargazers_count; }
  get watchers_count(): any { return this._watchers_count; }
  get language(): string { return this._language; }
  get has_issues(): boolean { return this._has_issues; }
  get has_wiki(): boolean { return this._has_wiki; }
  get has_pages(): boolean { return this._has_pages; }
  get forks_count(): any { return this._forks_count; }
  get open_issues_count(): any { return this._open_issues_count; }
  get forks(): any { return this._forks; }
  get open_issues(): any { return this._open_issues; }
  get watchers(): any { return this._watchers; }
  get license(): any { return this._license; }
  get default_branch(): any { return this._default_branch; }

  get organization(): Organization {
    return this._organization;
  }

  get baseUrl(): string {
    return this._baseUrl;
  }

  constructor(organization: Organization, entity: any, getAuthorizationHeader: IPurposefulGetAuthorizationHeader, operations: Operations) {
    this._organization = organization;
    if (entity) {
      common.assignKnownFieldsPrefixed(this, entity, 'repository', repoPrimaryProperties, repoSecondaryProperties);
    }
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
      common.assignKnownFieldsPrefixed(this, entity, 'repository', repoPrimaryProperties, repoSecondaryProperties);
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
    if (options.branch) {
      parameters.branch = options.branch;
    }
    if (options.committer) {
      parameters.committer = options.committer;
    }
    const alternateHeader = options.alternateToken ? `token ${options.alternateToken}` : null;
    return this._operations.github.post(alternateHeader || this.authorize(AppPurpose.Operations), 'repos.createOrUpdateFile', parameters);
  }

  setTeamPermission(teamId: number, newPermission: GitHubRepositoryPermission): Promise<any> {
    const options = {
      team_id: teamId,
      owner: this.organization.name,
      repo: this.name,
      permission: newPermission,
    };
    return this._operations.github.post(this.authorize(AppPurpose.Operations), 'teams.addOrUpdateRepo', options);
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
      const ok = await operations.github.post(this.authorize(AppPurpose.Data), 'teams.addOrUpdateRepo', parameters);
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
