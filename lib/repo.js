//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

const async = require('async');
const debug = require('debug')('azureossportal');

const githubEntityClassification = require('../data/github-entity-classification.json');

const utils = require('../utils');
const Issue = require('./issue');

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

module.exports = OpenSourceRepo;