//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

const express = require('express');
const router = express.Router();
const utils = require('../../../utils');
const approvalRoute = require('./approval/');

// Not a great place for these, should move into independent files eventually...

function PermissionWorkflowEngine(team, approvalPackage) {
  this.team = team;
  this.request = approvalPackage.request;
  this.user = approvalPackage.requestingUser;
  this.id = approvalPackage.id;
  this.typeName = 'Team Join';
}

PermissionWorkflowEngine.prototype.messageForAction = function (action) {
  var message = null;
  if (action == 'deny') {
    message = 'This team join request has not been approved at this time.';
  } else if (action == 'approve') {
    message = 'Permission request approved.';
  }
  return message;
};

PermissionWorkflowEngine.prototype.performApprovalOperation = function (callback) {
  var self = this;
  var team = self.team;
  team.addMembership('member', this.request.ghu, function (error) {
    if (error) {
      error = utils.wrapError(error, 'The GitHub API returned an error trying to add the user ' + this.request.ghu + ' to team ID ' + team.id + '.');
    }
    callback(error);
  });
};

// ---

function RepoWorkflowEngine(team, approvalPackage) {
  this.team = team;
  this.request = approvalPackage.request;
  this.user = approvalPackage.requestingUser;
  this.id = approvalPackage.id;
  this.typeName = 'Repository Create';
}

RepoWorkflowEngine.prototype.messageForAction = function (action) {
  var message = null;
  if (action == 'deny') {
    message = 'The repo was not approved at this time.';
  } else if (action == 'approve') {
    message = 'The repo has been created.';
  }
  return message;
};

RepoWorkflowEngine.prototype.editGet = function (req, res) {
  var self = this;
  var oss = self.team.oss;
  oss.render(req, res, 'org/team/approvals/editRepo', 'Edit Repo Request', {
    entry: this.request,
    teamUrl: req.teamUrl,
    team: req.team,
  });
};

RepoWorkflowEngine.prototype.editPost = function (req, res, next) {
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

RepoWorkflowEngine.prototype.getApprovedViewName = function () {
  return 'org/team/repos/repoCreated';
};

var createAddRepositoryTask = function createAddRepoTask(org, repoName, id, permission) {
  return function (cb) {
    org.team(id).addRepository(repoName, permission, function (error) {
      // Don't propagate as an error, just record the issue...
      var message = 'Successfully added the "' + repoName + '" repo to the team "' + id + '" with permission level ' + permission + '.';
      if (error) {
        message = 'The addition of the repo ' + repoName + ' to the team ' + id + ' could not be completed. The GitHub API returned an error.';
      }
      var result = {
        error: error,
        message: message,
      };
      cb(null, result);
    });
  };
};

RepoWorkflowEngine.prototype.generateSecondaryTasks = function (callback) {
  var self = this;
  var pendingRequest = self.request;
  var tasks = [];
  var org = self.team.org;
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
  callback(null, tasks);
};

RepoWorkflowEngine.prototype.performApprovalOperation = function (callback) {
  var self = this;
  var properties = {
    description: self.request.repoDescription,
    homepage: self.request.repoUrl,
    'private': self.request.repoVisibility == 'public' ? false : true,
  };
  var org = self.team.org;
  org.createRepository(self.request.repoName, properties, function (error) {
    if (error) {
      error = utils.wrapError(error, 'The GitHub API did not allow the creation of the new repo.');
    }
    callback(error);
  });
};

// ---

function createRequestEngine(team, approvalPackage, callback) {
  var engine = null;
  var rt = approvalPackage.request.type;
  switch (rt) {
  case 'repo':
    engine = new RepoWorkflowEngine(team, approvalPackage);
    break;
  default:
  case 'joinTeam':
    engine = new PermissionWorkflowEngine(team, approvalPackage);
    break;
  }
  if (!engine) {
    return callback(new Error('No request engine is supported for requests of type "' + rt + '".'));
  }
  callback(null, engine);
}

// Find the request and assign the workflow engine

router.use(function (req, res, next) {
  req.oss.addBreadcrumb(req, 'Approvals');
  next();
});

router.get('/', function (req, res, next) {
  var team = req.team;
  team.getApprovals(function (error, approvals) {
    if (error) {
      return next(error);
    }
    req.oss.render(req, res, 'org/team/approvals', 'Approvals for ' + team.name, {
      team: team,
      pendingApprovals: approvals,
      teamUrl: req.teamUrl,
    });
  });
});

router.use('/:requestid', function (req, res, next) {
  var team = req.team;
  var requestid = req.params.requestid;
  var oss = req.oss;
  var dc = req.app.settings.dataclient;
  dc.getApprovalRequest(requestid, function (error, pendingRequest) {
    if (error) {
      return next(utils.wrapError(error, 'The pending request you are looking for does not seem to exist.'));
    }
    var userHash = {};
    userHash[pendingRequest.ghu] = pendingRequest.ghid;
    var requestingUser = null;
    oss.getCompleteUsersFromUsernameIdHash(userHash,
      function (error, users) {
        if (!error && !users[pendingRequest.ghu]) {
          error = new Error('Could not create an object to track the requesting user.');
        }
        if (error) {
          return next(error);
        }
        requestingUser = users[pendingRequest.ghu];
        var approvalPackage = {
          request: pendingRequest,
          requestingUser: requestingUser,
          id: requestid,
        };
        createRequestEngine(team, approvalPackage, function (error, engine) {
          if (error) {
            return next(error);
          }
          oss.addBreadcrumb(req, engine.typeName + ' Request');
          req.approvalEngine = engine;
          next();
        });
      });
  });
});

// Pass on to the context-specific routes.
router.use('/:requestid', approvalRoute);

module.exports = router;
