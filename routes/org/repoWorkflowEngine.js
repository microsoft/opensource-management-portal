var utils = require('../../utils');
const async = require('async');
const fs = require('fs');
const path = require('path');

var repoWorkFlowEngine = RepoWorkflowEngine.prototype;

function RepoWorkflowEngine(team, org, approvalPackage) {
  this.team = team;
  this.request = approvalPackage.request;
  this.user = approvalPackage.requestingUser;
  this.id = approvalPackage.id;
  this.org = org;
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
  var self = this;
  var oss = self.team.oss;
  oss.render(req, res, 'org/team/approvals/editRepo', 'Edit Repo Request', {
    entry: this.request,
    teamUrl: req.teamUrl,
    team: req.team,
  });
};

repoWorkFlowEngine.editPost = function (req, res, next) {
  var self = this;
  var dc = self.team.oss.dataClient();
  var visibility = req.body.repoVisibility;
  if (!(visibility == 'public' || visibility == 'private')) {
    return next(new Error('Visibility for the repo request must be provided.'));
  }
  var updates = {
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
  var org = self.org;
  var repoName = pendingRequest.repoName;
  var teamsCount = Math.floor(pendingRequest.teamsCount);
  for (var i = 0; i < teamsCount; i++) {
    var key = 'teamid' + i;
    var teamId = pendingRequest[key];
    var permission = pendingRequest[key + 'p'];
    if (teamId && permission) {
      tasks.push(createAddRepositoryTask(org, repoName, teamId, permission));
    }
  }
  if (pendingRequest.claEntity) {
    tasks.push(createSetLegacyClaTask(org, repoName, pendingRequest.claEntity, pendingRequest.claMail));
  }
  if (pendingRequest.template) {
    tasks.push(createAddTemplateFilesTask(org, repoName, pendingRequest.template));
  }
  callback(null, tasks);
};

repoWorkFlowEngine.performApprovalOperation = function (callback) {
  var self = this;
  var properties = {
    description: self.request.repoDescription,
    homepage: self.request.repoUrl,
    'private': self.request.repoVisibility == 'public' ? false : true,
    gitignore_template: self.request.gitignore_template,
  };
  var org = self.org;
  org.createRepository(self.request.repoName, properties, function (error, newRepoDetails) {
    if (error) {
      error = utils.wrapError(error, `The GitHub API did not allow the creation of the new repo. ${error.message}`);
    }
    callback(error, newRepoDetails);
  });
};

function createSetLegacyClaTask(org, repoName, legalEntity, claMail) {
  'use strict';
  return function setLegacyClaTask(callback) {
    const repo = org.repo(repoName);
    repo.enableLegacyClaAutomation({
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

var createAddRepositoryTask = function createAddRepoTask(org, repoName, id, permission) {
  return function (cb) {
    async.retry({
      times: 3,
      interval: function (retryCount) {
        return 500 * Math.pow(2, retryCount);
      }
    }, function (callback) {
      org.team(id).addRepository(repoName, permission, function (error) {
        if (error) {
          return callback(error);
        }
        return callback();
      });
    }, function (error) {
      // Don't propagate as an error, just record the issue...
      var message = `Successfully added the "${repoName}" repo to GitHub team ID "${id}" with permission level ${permission.toUpperCase()}.`;
      if (error) {
        message = `The addition of the repo "${repoName}" to GitHub team ID "${id}" failed. The GitHub API returned an error: ${error.message}.`;
      }
      var result = {
        error: error,
        message: message,
      };
      cb(null, result);
    });
  };
};

function createAddTemplateFilesTask(org, repoName, templateName) {
  'use strict';
  const templatePath = path.join(__dirname, '../../data/templates/');
  const userName = org.oss.configuration.github.user.initialCommit.username;
  const token = org.oss.configuration.github.user.initialCommit.token;
  const repo = org.repo(repoName);
  let files = [];
  return (taskCallback) => {
    async.waterfall([

      function addCollaborator(callback) {
        repo.addCollaborator(userName, 'push', callback);
      },

      function createDatasource(callback) {
        fs.readdir(path.join(templatePath, templateName), (error, fileNames) => {
          async.parallel(fileNames.map(fileName => {
            return (cb) => {
              fs.readFile(path.join(templatePath, templateName, fileName), 'utf8', (error, file) => {
                cb(error, { path: fileName, content: file });
              });
            };
          }), callback);
        });
      },

      function addTemplateFiles(datasource, callback) {
        const message = 'Initial commit';
        async.series(datasource.map(item => {
          return (cb) => {
            repo.createContents(token, item.path, message, item.content, cb);
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
        repo.removeCollaborator(userName, callback);
      },
    ], (error) => {
      var message = `Initial commit of ${files.join(', ')} files to the ${repoName} repo succeeded.`;
      if (error) {
        message = `Initial commit of template file(s) to the ${repoName} repo failed. An error: ${error.message}.`;
      }
      var result = {
        error: error,
        message: message,
      };
      taskCallback(null, result);
    });
  };
}

module.exports = RepoWorkflowEngine;