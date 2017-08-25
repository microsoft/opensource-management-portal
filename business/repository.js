//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

const wrapError = require('../utils').wrapError;
const common = require('./common');

const Collaborator = require('./collaborator');
const RepositoryPermission = require('./repositoryPermission');
const TeamPermission = require('./teamPermission');

const legacyClaIntegration = require('./legacyClaIntegration');

const githubEntityClassification = require('../data/github-entity-classification.json');
const repoPrimaryProperties = githubEntityClassification.repo.keep;
const repoSecondaryProperties = githubEntityClassification.repo.strip;

class Repository {
  constructor(organization, entity, getToken, operations) {
    this.organization = organization;

    if (entity) {
      common.assignKnownFields(this, entity, 'repository', repoPrimaryProperties, repoSecondaryProperties);
    }

    const privates = _private(this);
    privates.getToken = getToken;
    privates.operations = operations;
  }

  getDetails(options, callback) {
    if (!callback && typeof(options) === 'function') {
      callback = options;
      options = null;
    }
    options = options || {};
    const self = this;
    const token = _private(this).getToken();
    const operations = _private(this).operations;
    const parameters = {
      owner: this.organization.name,
      repo: this.name,
    };
    const cacheOptions = {
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
      common.assignKnownFields(self, entity, 'repository', repoPrimaryProperties, repoSecondaryProperties);
      callback(null, entity);
    });
  }

  getBranches(cacheOptions, callback) {
    if (!callback && typeof (cacheOptions) === 'function') {
      callback = cacheOptions;
      cacheOptions = null;
    }
    cacheOptions = cacheOptions || {};
    const privates = _private(this);
    const operations = privates.operations;
    const token = privates.getToken();
    const github = operations.github;
    const parameters = {
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
    const token = _private(this).getToken();
    const operations = _private(this).operations;
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

    const privates = _private(this);
    const operations = privates.operations;
    const token = privates.getToken();
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
      return callback(null, new RepositoryPermission(this.organization, userPermissionLevel, privates.getToken, operations));
    });
  }

  getCollaborators(cacheOptions, callback) {
    if (!callback && typeof (cacheOptions) === 'function') {
      callback = cacheOptions;
      cacheOptions = null;
    }
    cacheOptions = cacheOptions || {};

    const privates = _private(this);
    const operations = privates.operations;
    const token = privates.getToken();
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
    // BREAKING CHANGE in the GitHub API: as of August 2017, this is "inviteCollaborator", it does not automatically add
    if (typeof permission == 'function') {
      callback = permission;
      permission = 'pull';
    }
    const destructured = getGitHubClient(this); // const [github, token] = getGitHubClient(this);
    const github = destructured[0];
    const token = destructured[1];
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
    const parameters = {
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

  enableLegacyClaAutomation(options, callback) {
    try {
      legacyClaIntegration.enable(this, options, callback);
    } catch (error) {
      return callback(error);
    }
  }

  hasLegacyClaAutomation(callback) {
    legacyClaIntegration.has(this, callback);
  }

  getLegacyClaSettings(callback) {
    const operations = _private(this).operations;
    legacyClaIntegration.getCurrentSettings(operations, this, callback);
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
    const token = _private(this).getToken();
    const operations = _private(this).operations;
    const parameters = {
      owner: this.organization.name,
      repo: this.name,
    };
    const cacheOptions = {
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

  getTeamPermissions(cacheOptions, callback) {
    if (!callback && typeof (cacheOptions) === 'function') {
      callback = cacheOptions;
      cacheOptions = null;
    }
    cacheOptions = cacheOptions || {};

    const privates = _private(this);
    const operations = privates.operations;
    const token = privates.getToken();
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
  const privates = _private(this);
  const operations = privates.operations;
  const getToken = privates.getToken;
  const permission = new TeamPermission(this.organization, entity, getToken, operations);
  return permission;
}

function collaboratorPermissionFromEntity(entity) {
  // 'this' is bound for this function to be a private method
  const privates = _private(this);
  const operations = privates.operations;
  const getToken = privates.getToken;
  const permission = new Collaborator(this.organization, entity, getToken, operations);
  return permission;
}

module.exports = Repository;

function getGitHubClient(self) {
  const privates = _private(self);
  const operations = privates.operations;
  const token = privates.getToken();
  const github = operations.github;
  return [github, token];
}

const privateSymbol = Symbol();
function _private(self) {
  if (!self) {
    throw new Error('Not bound to an instance.');
  }
  if (self[privateSymbol] === undefined) {
    self[privateSymbol] = {};
  }
  return self[privateSymbol];
}
