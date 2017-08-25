//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

/*eslint no-console: ["error", { allow: ["warn"] }] */

var utils = require('../../utils');
const async = require('async');
const fs = require('fs');
const path = require('path');
const recursiveReadDirectory = require('recursive-readdir');

var repoWorkFlowEngine = RepoWorkflowEngine.prototype;

function RepoWorkflowEngine(team, organization, approvalPackage) {
  this.team = team;
  this.request = approvalPackage.request;
  this.user = approvalPackage.requestingUser;
  this.id = approvalPackage.id;
  this.organization = organization;
  this.typeName = 'Repository Create';
}

repoWorkFlowEngine.messageForAction = function (action) {
  var message = null;
  if (action == 'deny') {
    message = 'The repo was not approved at this time.';
  } else if (action == 'approve') {
    message = 'The repo has been created.';
  }
  return message;
};

repoWorkFlowEngine.editGet = function (req, res) {
  req.legacyUserContext.render(req, res, 'org/team/approvals/editRepo', 'Edit Repo Request', {
    entry: this.request,
    teamUrl: req.teamUrl,
    team: req.team,
  });
};

repoWorkFlowEngine.editPost = function (req, res, next) {
  const self = this;
  const destructured = this.organization.getLegacySystemObjects(); // const [, operations] =
  const operations = destructured[1];
  const dc = operations.dataClient;
  const visibility = req.body.repoVisibility;
  if (!(visibility == 'public' || visibility == 'private')) {
    return next(new Error('Visibility for the repo request must be provided.'));
  }
  const updates = {
    repoName: req.body.repoName,
    repoVisibility: visibility,
    repoUrl: req.body.repoUrl,
    repoDescription: req.body.repoDescription,
  };
  dc.updateApprovalRequest(self.id, updates, function (error) {
    if (error) {
      return next(utils.wrapError(error, 'There was a problem updating the request.'));
    }
    res.redirect(req.teamUrl + 'approvals/' + self.id);
  });
};

repoWorkFlowEngine.getApprovedViewName = function () {
  return 'org/team/repos/repoCreated';
};

repoWorkFlowEngine.getDecisionEmailViewName = function () {
  return 'repoApprovals/decision';
};

repoWorkFlowEngine.getDecisionEmailSubject = function (approved, request) {
  return approved ? `Your ${request.repoName} repo is ready` : `Your ${request.repoName} repo request was not approved`;
};

repoWorkFlowEngine.getDecisionEmailHeadline = function (approved/*, request*/) {
  return approved ? 'Repo ready' : 'Request returned';
};

repoWorkFlowEngine.generateSecondaryTasks = function (callback) {
  var self = this;
  var pendingRequest = self.request;
  var tasks = [];
  var organization = self.organization;
  var repoName = pendingRequest.repoName;
  var teamsCount = Math.floor(pendingRequest.teamsCount);
  for (var i = 0; i < teamsCount; i++) {
    var key = 'teamid' + i;
    var teamId = pendingRequest[key];
    var permission = pendingRequest[key + 'p'];
    if (teamId && permission) {
      tasks.push(createAddRepositoryTask(organization, repoName, teamId, permission));
    }
  }
  if (pendingRequest.claEntity) {
    tasks.push(createSetLegacyClaTask(organization, repoName, pendingRequest.claEntity, pendingRequest.claMail));
  }
  if (pendingRequest.template) {
    tasks.push(createAddTemplateFilesTask(organization, repoName, pendingRequest.template));
  }
  callback(null, tasks);
};

repoWorkFlowEngine.performApprovalOperation = function (callback) {
  const self = this;
  const properties = {
    description: self.request.repoDescription,
    homepage: self.request.repoUrl,
    'private': self.request.repoVisibility == 'public' ? false : true,
    gitignore_template: self.request.gitignore_template,
  };
  const organization = self.organization;
  organization.createRepository(self.request.repoName, properties, function (error, newRepositoryInstance, newRepoDetails) {
    if (error) {
      error = utils.wrapError(error, `The GitHub API did not allow the creation of the new repo. ${error.message}`);
    }
    callback(error, newRepoDetails);
  });
};

function createSetLegacyClaTask(organization, repoName, legalEntity, claMail) {
  'use strict';
  return function setLegacyClaTask(callback) {
    const repository = organization.repository(repoName);
    repository.enableLegacyClaAutomation({
      emails: claMail,
      legalEntity: legalEntity,
    }, (enableClaError) => {
      // Don't propagate as an error, just record the issue...
      let message = claMail ? `Successfully enabled the ${legalEntity} CLA for ${repoName}, notifying ${claMail}.` : `Successfully enabled the ${legalEntity} CLA for ${repoName}`;
      if (enableClaError) {
        message = `The CLA could not be enabled for the repo ${repoName} using the notification e-mail address(es) ${claMail} (${enableClaError})`;
      }
      const result = {
        error: enableClaError,
        message: message,
      };
      callback(undefined, result);
    });
  };
}

var createAddRepositoryTask = function createAddRepoTask(organization, repoName, id, permission) {
  return function (cb) {
    async.retry({
      times: 3,
      interval: function (retryCount) {
        return 500 * Math.pow(2, retryCount);
      }
    }, function (callback) {
      organization.repository(repoName).setTeamPermission(id, permission, callback);
    }, function (error) {
      // Don't propagate as an error, just record the issue...
      let message = `Successfully added the "${repoName}" repo to GitHub team ID "${id}" with permission level ${permission.toUpperCase()}.`;
      if (error) {
        message = `The addition of the repo "${repoName}" to GitHub team ID "${id}" failed. The GitHub API returned an error: ${error.message}.`;
      }
      const result = {
        error: error,
        message: message,
      };
      return cb(null, result);
    });
  };
};

function createAddTemplateFilesTask(organization, repoName, templateName) {
  'use strict';
  const templatePath = path.join(__dirname, '../../data/templates/');
  const destructured = organization.getLegacySystemObjects(); // const [, operations] =
  const operations = destructured[1];
  const config = operations.config;
  const userName = config.github.user.initialCommit.username;
  const token = config.github.user.initialCommit.token;
  const alternateTokenOptions = {
    alternateToken: token,
  };
  const repository = organization.repository(repoName);
  let files = [];
  return (taskCallback) => {
    async.waterfall([

      function inviteCollaborator() {
        const callback = Array.prototype.slice.call(arguments).pop();
        repository.addCollaborator(userName, 'push', (invitationError, response) => {
          if (invitationError) {
            return callback(invitationError);
          }
          const invitationId = response.id;
          if (!invitationId) {
            return callback(new Error('No invitation was created for the repository'));
          }
          repository.acceptCollaborationInvite(invitationId, alternateTokenOptions, callback);
        });
      },

      function createDatasource() {
        const callback = Array.prototype.slice.call(arguments).pop();
        const templateRoot = path.join(templatePath, templateName);
        recursiveReadDirectory(templateRoot, (error, fileNames) => {
          async.parallel(fileNames.map(absoluteFileName => {
            const fileName = path.relative(templateRoot, absoluteFileName);
            return next => {
              fs.readFile(path.join(templatePath, templateName, fileName), (error, file) => {
                const base64content = file.toString('base64');
                next(error,
                  {
                    path: fileName,
                    content: base64content,
                  });
              });
            };
          }), callback);
        });
      },

      function addTemplateFiles(datasource) {
        const callback = Array.prototype.slice.call(arguments).pop();
        const message = 'Initial commit';
        async.series(datasource.map(item => {
          return next => {
            repository.createFile(item.path, item.content, message, alternateTokenOptions, next);
          };
        }), (error, result) => {
          if (!error) {
            files = datasource.map((item) => {
              return item.path;
            });
          }
          callback(error, result);
        });
      },

      function removeCollaborator(result, callback) {
        repository.removeCollaborator(userName, callback);
      },
    ], error => {
      let message = `Initial commit of ${files.join(', ')} files to the ${repoName} repo succeeded.`;
      if (error) {
        message = `Initial commit of template file(s) to the ${repoName} repo failed. Error: ${error.message}.`;
      }
      const result = {
        error: error,
        message: message,
      };
      taskCallback(null, result);
    });
  };
}

module.exports = RepoWorkflowEngine;
