//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

import { wrapError } from '../utils';
import { Operations } from "./operations";
import { Organization } from "./organization";
import { ICacheOptions } from "../transitional";
import * as common from './common';
import { RepositoryPermission } from "./repositoryPermission";
import { Collaborator } from "./collaborator";
import { TeamPermission } from "./teamPermission";

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

  private _getToken;
  private _operations: Operations;

  private _organization: Organization;

  private _id: string;
  private _name: string;
  private _full_name: string;
  private _private: boolean;
  private _html_url: string;
  private _description: string;
  private _fork: any;
  private _url: string;
  private _created_at: any;
  private _updated_at: any;
  private _pushed_at: any;
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

  get id(): string { return this._id; }
  get name(): string { return this._name; }
  get full_name(): string { return this._full_name; }
  get private(): boolean { return this._private; }
  get html_url(): string { return this._html_url; }
  get description(): string { return this._description; }
  get fork(): any { return this._fork; }
  get url(): string { return this._url; }
  get created_at(): any { return this._created_at; }
  get updated_at(): any { return this._updated_at; }
  get pushed_at(): any { return this._pushed_at; }
  get git_url(): string { return this._git_url; }
  get homepage(): string { return this._homepage; }
  get size(): any { return this._size; }
  get stargazers_count(): any { return this._stargazers_count; }
  get watchers_count(): any { return this._watchers_count; }
  get language(): any { return this._language; }
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

  constructor(organization: Organization, entity, getToken, operations: Operations) {
    this._organization = organization;

    if (entity) {
      common.assignKnownFieldsPrefixed(this, entity, 'repository', repoPrimaryProperties, repoSecondaryProperties);
    }

    this._getToken = getToken;
    this._operations = operations;
  }

  get disasterRecoveryRepositoryUrl() {
    if (this.private) return;

    if (this.organization.disasterRecoveryVstsPath) {
      return `${this.organization.disasterRecoveryVstsPath}${this.name}`;
    }
  }

  getDetails(options, callback) {
    if (!callback && typeof(options) === 'function') {
      callback = options;
      options = null;
    }
    options = options || {};
    const self = this;
    const token = this._getToken();
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
    return operations.github.call(token, 'repos.get', parameters, cacheOptions, (error, entity) => {
      if (error) {
        const notFound = error.code && error.code === 404;
        return callback(wrapError(error, notFound ? 'The repo could not be found.' : 'Could not get details about the repo.', notFound));
      }
      common.assignKnownFieldsPrefixed(self, entity, 'repository', repoPrimaryProperties, repoSecondaryProperties);
      callback(null, entity);
    });
  }

  getBranches(cacheOptions, callback) {
    if (!callback && typeof (cacheOptions) === 'function') {
      callback = cacheOptions;
      cacheOptions = null;
    }
    cacheOptions = cacheOptions || {};
    const operations = this._operations;
    const token = this._getToken();
    const github = operations.github;
    const parameters: IGetBranchesParameters = {
      owner: this.organization.name,
      repo: this.name,
      per_page: 100,
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
    // NOTE: This method does not return a strongly-typed "branch" object or anything like that
    return github.collections.getRepoBranches(
      token,
      parameters,
      cacheOptions,
      callback);
  }

  getContent(path, options, callback) {
    if (!callback && typeof (options) === 'function') {
      callback = options;
      options = null;
    }
    options = options || {};
    const ref = options.branch || options.tag || options.ref || 'master';
    const parameters = {
      owner: this.organization.name,
      repo: this.name,
      path: path,
      ref: ref,
    };
    const token = this._getToken();
    const operations = this._operations
    return operations.github.call(token, 'repos.getContent', parameters, (error, content) => {
      if (error) {
        return callback(error);
      }
      callback(null, content);
    });
  }

  getCollaborator(username, cacheOptions, callback) {
    if (!callback && typeof (cacheOptions) === 'function') {
      callback = cacheOptions;
      cacheOptions = null;
    }
    cacheOptions = cacheOptions || {};

    const operations = this._operations;
    const token = this._getToken();
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

    return github.call(token, 'repos.reviewUserPermissionLevel', parameters, (error, userPermissionLevel) => {
      if (error) {
        return callback(error);
      }
      return callback(null, new RepositoryPermission(this.organization, userPermissionLevel, this._getToken, operations));
    });
  }

  getCollaborators(cacheOptions, callback) {
    if (!callback && typeof (cacheOptions) === 'function') {
      callback = cacheOptions;
      cacheOptions = null;
    }
    cacheOptions = cacheOptions || {};

    const operations = this._operations;
    const token = this._getToken();
    const github = operations.github;

    const parameters = {
      owner: this.organization.name,
      repo: this.name,
      per_page: 100,
      affiliation: cacheOptions.affiliation || 'all',
    };

    delete cacheOptions.affiliation;

    if (!cacheOptions.maxAgeSeconds) {
      cacheOptions.maxAgeSeconds = operations.defaults.orgRepoCollaboratorsStaleSeconds;
    }
    if (cacheOptions.backgroundRefresh === undefined) {
      cacheOptions.backgroundRefresh = true;
    }

    return github.collections.getRepoCollaborators(
      token,
      parameters,
      cacheOptions,
      common.createInstancesCallback(this, collaboratorPermissionFromEntity, callback));
  }

  addCollaborator(username, permission, callback) {
    // BREAKING CHANGE in the GitHub API: as of August 2017, this is "inviteCollaborator', it does not automatically add
    if (typeof permission == 'function') {
      callback = permission;
      permission = 'pull';
    }
    const github = this._operations.github;
    const token = this._getToken();
    const parameters = {
      owner: this.organization.name,
      repo: this.name,
      username: username,
      permission: permission,
    };
    // CONSIDER: If status code 404 on return, the username does not exist on GitHub as entered
    github.post(token, 'repos.addCollaborator', parameters, callback);
  }

  acceptCollaborationInvite(invitationId, options, callback) {
    // This could go in Account _or_ here in Repository
    if (!callback && typeof (options) === 'function') {
      callback = options;
      options = null;
    }
    options = options || {};
    const destructured = getGitHubClient(this); // const [github, token] = getGitHubClient(this);
    const github = destructured[0];
    const token = destructured[1];
    const parameters = {
      invitation_id: invitationId,
    };
    github.post(options.alternateToken || token, 'users.acceptRepoInvite', parameters, callback);
  }

  removeCollaborator(username, callback) {
    const destructured = getGitHubClient(this); // const [github, token] = getGitHubClient(this);
    const github = destructured[0];
    const token = destructured[1];
    const parameters = {
      owner: this.organization.name,
      repo: this.name,
      username: username,
    };
    github.post(token, 'repos.removeCollaborator', parameters, callback);
  }

  delete(callback) {
    const destructured = getGitHubClient(this); // const [github, token] = getGitHubClient(this);
    const github = destructured[0];
    const token = destructured[1];
    const parameters = {
      owner: this.organization.name,
      repo: this.name,
    };
    github.post(token, 'repos.delete', parameters, callback);
  }

  createFile(path, content, commitMessage, options, callback) {
    if (!callback && typeof (options) === 'function') {
      callback = options;
      options = null;
    }
    options = options || {};
    const destructured = getGitHubClient(this); // const [github, token] = getGitHubClient(this);
    const github = destructured[0];
    const token = destructured[1];
    const parameters: ICreateFileParameters = {
      owner: this.organization.name,
      repo: this.name,
      path: path,
      message: commitMessage,
      content: content,
    };
    if (options.branch) {
      parameters.branch = options.branch;
    }
    if (options.committer) {
      parameters.committer = options.committer;
    }
    let createFileToken = options.alternateToken || token;
    github.post(createFileToken, 'repos.createFile', parameters, callback);
  }

  setTeamPermission(teamId, newPermission, callback) {
    const destructured = getGitHubClient(this); // const [github, token] = getGitHubClient(this);
    const github = destructured[0];
    const token = destructured[1];
    const options = {
      id: teamId,
      org: this.organization.name,
      repo: this.name,
      permission: newPermission,
    };
    github.post(token, 'orgs.addTeamRepo', options, callback);
  }

  getWebhooks(options, callback) {
    if (!callback && typeof(options) === 'function') {
      callback = options;
      options = null;
    }
    options = options || {};
    const token = this._getToken();
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
    return operations.github.call(token, 'repos.getHooks', parameters, cacheOptions, callback);
  }

  deleteWebhook(webhookId, callback) {
    const destructured = getGitHubClient(this); // const [github, token] = getGitHubClient(this);
    const github = destructured[0];
    const token = destructured[1];
    const parameters = {
      owner: this.organization.name,
      repo: this.name,
      id: webhookId,
    };
    github.post(token, 'repos.deleteHook', parameters, callback);
  }

  createWebhook(options, callback) {
    const destructured = getGitHubClient(this); // const [github, token] = getGitHubClient(this);
    const github = destructured[0];
    const token = destructured[1];

    delete options.owner;
    delete options.repo;

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

    github.post(token, 'repos.createHook', parameters, callback);
  }

  getTeamPermissions(cacheOptions, callback?) {
    if (!callback && typeof (cacheOptions) === 'function') {
      callback = cacheOptions;
      cacheOptions = null;
    }
    cacheOptions = cacheOptions || {};

    const operations = this._operations;
    const token = this._getToken();
    const github = operations.github;

    const parameters = {
      owner: this.organization.name,
      repo: this.name,
      per_page: 100,
    };

    if (!cacheOptions.maxAgeSeconds) {
      cacheOptions.maxAgeSeconds = operations.defaults.orgRepoTeamsStaleSeconds;
    }
    if (cacheOptions.backgroundRefresh === undefined) {
      cacheOptions.backgroundRefresh = true;
    }

    return github.collections.getRepoTeams(
      token,
      parameters,
      cacheOptions,
      common.createInstancesCallback(this, teamPermissionFromEntity, callback));
  }
}

function teamPermissionFromEntity(entity) {
  // 'this' is bound for this function to be a private method
  const operations = this._operations;
  const getToken = this._getToken;
  const permission = new TeamPermission(this.organization, entity, getToken, operations);
  return permission;
}

function collaboratorPermissionFromEntity(entity) {
  // 'this' is bound for this function to be a private method
  const operations = this._operations;
  const getToken = this._getToken;
  const permission = new Collaborator(this.organization, entity, getToken, operations);
  return permission;
}

function getGitHubClient(self) {
  const operations = self._operations;
  const token = self._getToken();
  const github = operations.github;
  return [github, token];
}

interface ICreateFileParameters {
  owner: string;
  repo: string;
  path: string;
  message: string;
  content: string;
  branch?: string;
  committer?: any;
}

interface IGetBranchesParameters {
  owner: string;
  repo: string;
  per_page: number;
  protected?: any;
}
