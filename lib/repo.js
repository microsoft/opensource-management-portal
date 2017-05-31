//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

const async = require('async');
const debug = require('debug')('azureossportal');

const githubEntityClassification = require('../data/github-entity-classification.json');

const utils = require('../utils');
const Issue = require('./issue');
const ossManagementDb = require('./ossManagementDb');

function OpenSourceRepo(orgInstance, repoName, optionalGitHubInstance) {
  if (!orgInstance) {
    throw new Error('orgInstance is not defined.');
  }
  this.org = orgInstance;
  this.oss = this.org.oss;
  var i = repoName.indexOf('/');
  if (i >= 0) {
    this.full_name = repoName;
    var orgName = repoName.substring(0, i);
    repoName = repoName.substring(i + 1);
    if (orgName.toLowerCase() !== orgInstance.name.toLowerCase()) {
      debug('WARNING: The org name does not match: (' + orgName + ', ' + orgInstance.name + ')');
    }
  } else {
    this.full_name = orgInstance.name + '/' + repoName;
  }
  this.name = repoName;
  this.inner = {
    issues: {}
  };
  this.otherFields = {};
  this._detailsLoaded = false;
  if (optionalGitHubInstance) {
    setDetails(this, optionalGitHubInstance);
  }
}

// ----------------------------------------------------------------------------
// Properties of interest in the standard GitHub response for a user
// ----------------------------------------------------------------------------
var detailsToCopy = githubEntityClassification.repo.keep;
var detailsToSkip = githubEntityClassification.repo.strip;

// ----------------------------------------------------------------------------
// Creates a GitHub API client for this repo.
// ----------------------------------------------------------------------------
OpenSourceRepo.prototype.createGitHubRepoClient = function (alternateToken) {
  var client = this.org.createGenericGitHubClient(alternateToken);
  debug('creating repo client for ' + this.org.name + '/' + this.name);
  return client.repo(this.org.name + '/' + this.name);
};

// ----------------------------------------------------------------------------
// Retrieve the details for the repo.
// ----------------------------------------------------------------------------
OpenSourceRepo.prototype.getDetails = function (callback) {
  'use strict';
  const self = this;
  const token = this.org.inner.settings.ownerToken;
  const options = {
    owner: this.org.name,
    repo: this.name,
  };
  return this.oss.githubLibrary.call(token, 'repos.get', options, (error, details) => {
    if (error) {
      return callback(utils.wrapError(error, 'Could not get details about the repo. It may not exist.'));
    }
    setDetails(self, details);
    callback(null, details);
  });
};

// ----------------------------------------------------------------------------
// Get contribution statistics for the repo.
// ----------------------------------------------------------------------------
OpenSourceRepo.prototype.contributorsStatsOneTime = function (callback) {
  this.createGitHubRepoClient().contributorsStats(function (error, stats) {
    if (error) {
      var er = utils.wrapError(error, '');
      if (error && error.status && error.status == 202) {
        er.status = 202;
      }
      return callback(er);
    }
    callback(null, stats);
  });
};

// ----------------------------------------------------------------------------
// Add a collaborator with a specified permission level.
// ----------------------------------------------------------------------------
OpenSourceRepo.prototype.addCollaborator = function (githubUsername, permissionLevel, callback) {
  if (typeof permissionLevel == 'function') {
    callback = permissionLevel;
    permissionLevel = 'pull';
  }
  this.createGitHubRepoClient().addCollaborator(githubUsername, {
    permission: permissionLevel,
  }, function (error /*, ignoredInfo */) {
    if (error) {
      var userIntended = error.statusCode == 404;
      var message = error.statusCode == 404 ? 'The GitHub username "' + githubUsername + '" does not exist.' : 'The collaborator could not be added to GitHub at this time. There may be a problem with the GitHub API.';
      return callback(utils.wrapError(error, message, userIntended));
    }
    callback();
  });
};

// ----------------------------------------------------------------------------
// Remove a collaborator.
// ----------------------------------------------------------------------------
OpenSourceRepo.prototype.removeCollaborator = function (githubUsername, callback) {
  var self = this;
  this.createGitHubRepoClient().removeCollaborator(githubUsername, function (error) {
    if (error) {
      return callback(utils.wrapError(error, 'The collaborator could not be removed at this time. Was "' + githubUsername + '" even a collaborator for ' + self.name + '?'));
    }
    callback();
  });
};

// ----------------------------------------------------------------------------
// Retrieve the list of teams that maintain this repo.
// ----------------------------------------------------------------------------
OpenSourceRepo.prototype.teams = function getRepoTeamList(allowRedis, callback) {
  var self = this;
  if (typeof allowRedis == 'function') {
    callback = allowRedis;
    allowRedis = true;
  }
  var instancesFromJson = function (teamInstances) {
    async.map(teamInstances, function (teamInstance, cb) {
      cb(null, self.org.team(teamInstance.id, teamInstance));
    }, callback);
  };
  var redisKey = 'org#' + self.org.name + '/repo#' + self.name + ':teams';
  self.oss.redis.getObject(redisKey, function (error, data) {
    if (!error && data && allowRedis === true) {
      return instancesFromJson(data);
    }
    var ghrepo = self.createGitHubRepoClient();
    ghrepo.teams(function (error, teamInstances) {
      if (error) {
        return callback(error);
      }
      self.oss.redis.setObjectWithExpire(redisKey, teamInstances, utils.randomInteger(20, 90), function () {
        instancesFromJson(teamInstances);
      });
    });
  });
};

// ----------------------------------------------------------------------------
// Retrieve all web hooks directly installed on the GitHub repo.
// ----------------------------------------------------------------------------
OpenSourceRepo.prototype.getWebhooks = function (callback) {
  const client = this.createGitHubRepoClient();
  utils.retrieveAllPages(client.hooks.bind(client), (error, hooks) => {
    if (error) {
      return callback(utils.wrapError(error, 'Could not retrieve the web hooks for the repo.'));
    }
    callback(null, hooks);
  });
};

// ----------------------------------------------------------------------------
// Retrieve all web hooks directly installed on the GitHub repo (no pagination).
// ----------------------------------------------------------------------------
OpenSourceRepo.prototype.getAllWebhooks = function (callback) {
  const client = this.createGitHubRepoClient();
  client.hooks(callback);
};

// ----------------------------------------------------------------------------
// Delete a web hook by id directly installed on the GitHub repo.
// ----------------------------------------------------------------------------
OpenSourceRepo.prototype.deleteWebhook = function (id, callback) {
  const client = this.createGitHubRepoClient();
  client.deleteHook(id, callback);
};

// ----------------------------------------------------------------------------
// Create a web hook directly installed on the GitHub repo.
// events object example: ['push', 'pull_request']
// ----------------------------------------------------------------------------
OpenSourceRepo.prototype.createWebhook = function (url, events, callback) {
  const client = this.createGitHubRepoClient();
  client.hook({
    name: 'web',
    active: true,
    events: events,
    config: {
      url: url,
      content_type: 'json',
    }
  }, callback);
};

// ----------------------------------------------------------------------------
// Set the legacy CLA automation information for the repo.
// This method should not be open sourced, as it is an internal API for
// system migration purposes.
// ----------------------------------------------------------------------------
OpenSourceRepo.prototype.enableLegacyClaAutomation = function enableLegacyClaAutomation(options, callback) {
  const self = this;
  'use strict';
  options = options || {};
  // if (!options.emails) {
  //   return callback(new Error('At least one e-mail must be provided to the enable CLA endpoint.'));
  // }
  if (!options.legalEntity) {
    return callback(new Error('The CLA legal entity is required.'));
  }
  const available = this.org.isLegacyClaAutomationAvailable();
  if (available === 'offline') {
    return callback(new Error('CLA automation features are temporarily offline.'));
  } else if (available === false) {
    return callback(new Error('This organization has not enabled CLA automation features.'));
  }
  const legalEntity = options.legalEntity;
  const claTeams = this.org.getLegacyClaTeams(false /* do not throw if not configured */);
  let claTeam = claTeams[legalEntity];
  if (!claTeam) {
    return callback(new Error(`No CLA configuration available for the organization and the ${legalEntity} CLA.`));
  }
  const orgDbID = self.org.setting('ossDatabaseId');
  if (!orgDbID) {
    return callback(new Error('No known OSS database ID!!!'));
  }
  const claEntities = self.oss.setting('cla').entities;
  let claData = {
    repoName: self.name,
    organizationName: self.org.name,
    organizationId: orgDbID,
    description: self.description,
    isPrivate: self.private || true,
    repoGitHubId: self.id,
    webHookId: null,
    emails: options.emails,
    legalEntity: legalEntity,
    licenseId: claEntities[legalEntity].licenseId,
    createdAt: self.created_at,
    updatedAt: self.updated_at || Date.now(),
    sourceUrl: self.html_url,
    isFork: self.fork || false
  };
  async.waterfall([
    function getRepoDetails(callback) {
      if (claData.repoGitHubId) { // The data for existing repos should be pre-populated.
        return callback(null);
      }
      self.getDetails(() => { // Populate repo details for new repos.
        claData.description = self.description;
        claData.isPrivate = self.private || true;
        claData.repoGitHubId = self.id;
        claData.createdAt = self.created_at;
        claData.updatedAt = self.updated_at;
        claData.sourceUrl = self.html_url;
        claData.isFork = self.fork || false;
        callback(null);
      });
    },
    function getClaTeam(callback) {
      self.oss.getTeam(claTeam.id, callback);
    },
    function addRepoToClaTeam(team, callback) {
      self.oss.insights.trackEvent('AddRepoToClaTeam', { repoName: self.name, claTeamId: claTeam.id });
      team.addRepository(self.name, 'push', callback);
    },
    function getRepoWebhooks(response, body, callback) {
      self.getAllWebhooks(callback);
    },
    function findRepoWebhooksAndDeleteOtherClaWebhooks(webhooks, response, callback) {
      if (!webhooks || webhooks.length === 0) {
        return callback();
      }
      return async.eachSeries(webhooks, (webhook, next) => {
        let webhookUrl = null;
        if (webhook && webhook.config) {
          webhookUrl = webhook.config.url;
        }
        if (webhookUrl === claEntities[claData.legalEntity].webhookUrl) {
          // CLA webhook already exists for this CLA entity.
          claData.webHookId = webhook.id;
          return next();
        } else {
          const claKeys = Object.keys(claEntities);
          return async.eachSeries(claKeys, (key, innerNext) => {
            if (claEntities[key].webhookUrl === webhookUrl) {
              // Check if there is another existing CLA webhook.
              self.oss.insights.trackEvent('DeleteClaWebhook', { repoName: self.name, claEntity: key, webhookUrl: webhookUrl });
              self.deleteWebhook(webhook.id, innerNext);
            } else {
              return innerNext();
            }
          }, next);
        }
      }, callback);
    },
    function addClaWebhook(callback) {
      if (claData.webHookId) { // CLA web hook already exists
        return callback(null);
      }
      self.oss.insights.trackEvent('AddClaWebhook', { repoName: self.name, claEntity: claData.legalEntity, webhookUrl: claEntities[claData.legalEntity].webhookUrl });
      self.createWebhook(claEntities[claData.legalEntity].webhookUrl, ['pull_request'], (error, response) => {
        claData.webHookId = response.id;
        return callback(null);
      });
    },
    function upsertClaReposDataInDb(callback) {
      self.oss.insights.trackEvent('UpsertClaReposDataInDb', claData);
      const ossDbClient = self.oss.ossDbClient();
      ossManagementDb.upsertClaRepositoryData(ossDbClient, claData, callback);
    }
  ], function asyncComplete(error) {
    if (error) {
      self.oss.insights.trackException(error, { name: 'EnableLegacyClaAutomationError' });
    }
    return callback(error);
  });
};

// ----------------------------------------------------------------------------
// Retrieve legacy database settings.
// ----------------------------------------------------------------------------
OpenSourceRepo.prototype.getLegacyClaSettings = function (callback) {
  const self = this;
  const ossDbClient = self.oss.ossDbClient();
  ossManagementDb.getClaRepositorySettings(ossDbClient, this.id, callback);
};

// ----------------------------------------------------------------------------
// Checks whether there may be a CLA rule assigned by looking for the web hook.
// This is a cheap and quick way to do this instead of getting a way to query
// the old legacy hub API to see if one exists (since no such API exists yet).
// ----------------------------------------------------------------------------
OpenSourceRepo.prototype.hasLegacyClaAutomation = function hasLegacyClaAutomation(callback) {
  const self = this;
  self.getWebhooks((error, webhooks) => {
    if (error || !webhooks) {
      return callback(utils.wrapError(error, 'Could not retrieve the web hooks to check for CLA automation.'));
    }
    for (var i = 0; i < webhooks.length; i++) {
      var webhook = webhooks[i];
      if (
          webhook &&
          webhook.config &&
          webhook.config.url &&
          webhook.config.url === 'https://cla.microsoft.com/webhooks/pullrequest' ||
          webhook.config.url === 'https://cla.azure.com/webhooks/pullrequest' ||
          webhook.config.url === 'https://cla2.msopentech.com/webhooks/pullrequest' ||
          webhook.config.url === 'https://cla2.dotnetfoundation.org/webhooks/pullrequest') {

        var legalEntity = 'Unknown or former legal entity';
        if (webhook.config.url === 'https://cla.microsoft.com/webhooks/pullrequest' || webhook.config.url === 'https://cla.azure.com/webhooks/pullrequest') {
          legalEntity = 'Microsoft';
        } else if (webhook.config.url === 'https://cla2.msopentech.com/webhooks/pullrequest') {
          legalEntity = 'Microsoft Open Technologies, Inc.';
        } else if (webhook.config.url === 'https://cla2.dotnetfoundation.org/webhooks/pullrequest') {
          legalEntity = '.NET Foundation';
        }

        return callback(null, true, webhook.config.url, legalEntity, 'https://opensource.microsoft.com/resources');
      }
    }
    return callback(null, false);
  });
};

// ----------------------------------------------------------------------------
// Update the repo properties with a patch.
// ----------------------------------------------------------------------------
OpenSourceRepo.prototype.update = function updateRepo(patch, callback) {
  // CONSIDER: Wrap errors.
  this.createGitHubRepoClient().update(patch, callback);
};

// ----------------------------------------------------------------------------
// Delete the repo from GitHub.
// ----------------------------------------------------------------------------
OpenSourceRepo.prototype.delete = function deleteRepo(callback) {
  // CONSIDER: Wrap errors.
  this.createGitHubRepoClient().destroy(callback);
};

// ----------------------------------------------------------------------------
// Retrieve a repo-scoped issue object.
// ----------------------------------------------------------------------------
OpenSourceRepo.prototype.issue = function getIssueInstance(issueNumber, optionalInitialData) {
  var self = this;
  if (typeof issueNumber != 'string') {
    issueNumber = issueNumber.toString();
  }
  if (self.inner.issues[issueNumber]) {
    return self.inner.issues[issueNumber];
  } else {
    self.inner.issues[issueNumber] = new Issue(self, issueNumber, optionalInitialData);
    return self.inner.issues[issueNumber];
  }
};

// CONSIDER: OLD: Is this needed still?
OpenSourceRepo.prototype.createIssue = function (issue, callback) {
  var fullName = this.full_name;
  var repositoryClient = this.oss.createGenericGitHubClient().repo(fullName);
  repositoryClient.createIssue(issue, function (error, createdIssue) {
    if (error) {
      error = utils.wrapError(error, 'We had trouble opening an issue to track this request in the ' + fullName + ' repo.');
    }
    callback(error, createdIssue);
  });
};

// CONSIDER: OLD: Is this needed still?
OpenSourceRepo.prototype.updateIssue = function (issueNumber, patch, callback) {
  var fullName = this.full_name;
  var issueClient = this.oss.createGenericGitHubClient().issue(this.full_name, issueNumber);
  issueClient.update(patch, function (error, updatedIssue) {
    if (error) {
      error = utils.wrapError(error, 'We had trouble updated the issue in the ' + fullName + ' repo.');
    }
    callback(error, updatedIssue);
  });
};

function setDetails(self, details) {
  'use strict';
  let knownKeys = new Set();
  var key = null;
  for (var i = 0; i < detailsToCopy.length; i++) {
    key = detailsToCopy[i];
    self[key] = details[key];
    knownKeys.add(key);
  }
  for (i = 0; i < detailsToSkip.length; i++) {
    key = detailsToSkip[i];
    self.otherFields[key] = details[key];
    knownKeys.add(key);
  }
  for (var k in details) {
    if (!knownKeys.has(k)) {
      debug('Repo details import, remaining key: ' + k);
    }
  }
  self._detailsLoaded = true;
}

// ----------------------------------------------------------------------------
// Add new file into a repo
// ----------------------------------------------------------------------------
OpenSourceRepo.prototype.createContents = function (alternateToken, path, message, content, cbOrBranchOrOptions, cb) {
  this.createGitHubRepoClient(alternateToken).createContents(path, message, content, cbOrBranchOrOptions, cb);
};

module.exports = OpenSourceRepo;