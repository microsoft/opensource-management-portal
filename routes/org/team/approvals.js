//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

const express = require('express');
const router = express.Router();
const utils = require('../../../utils');
const approvalRoute = require('./approval/');
const async = require('async');

// Not a great place for these, should move into independent files eventually...

function PermissionWorkflowEngine(team, approvalPackage) {
  this.team = team;
  if (!team) {
    throw new Error('No team instance');
  }
  this.request = approvalPackage.request;
  this.user = approvalPackage.requestingUser;
  this.id = approvalPackage.id;
  this.typeName = 'Team Join';
}

PermissionWorkflowEngine.prototype.getDecisionEmailViewName = function () {
  return 'membershipApprovals/decision';
};

PermissionWorkflowEngine.prototype.getDecisionEmailSubject = function (approved, request) {
  return approved ? `Welcome to the ${request.teamname} ${request.org} GitHub team` : `Your ${request.teamname} permission request was not approved`;
};

PermissionWorkflowEngine.prototype.getDecisionEmailHeadline = function (approved/*, request*/) {
  return approved ? 'Welcome' : 'Sorry';
};


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
  req.legacyUserContext.render(req, res, 'org/team/approvals/editRepo', 'Edit Repo Request', {
    entry: this.request,
    teamUrl: req.teamUrl,
    team: req.team,
  });
};

RepoWorkflowEngine.prototype.editPost = function (req, res, next) {
  const self = this;
  const dc = req.app.settings.providers.dataClient;
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

RepoWorkflowEngine.prototype.getApprovedViewName = function () {
  return 'org/team/repos/repoCreated';
};

RepoWorkflowEngine.prototype.getDecisionEmailViewName = function () {
  return 'repoApprovals/decision';
};

RepoWorkflowEngine.prototype.getDecisionEmailSubject = function (approved, request) {
  return approved ? `Your new repo, ${request.repoName}, is ready` : `Your ${request.repoName} repo request was not approved`;
};

RepoWorkflowEngine.prototype.getDecisionEmailHeadline = function (approved/*, request*/) {
  return approved ? 'Repo ready' : 'Request returned';
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
      let message = `Successfully enabled the ${legalEntity} CLA for ${repoName}, notifying ${claMail}.`;
      if (enableClaError) {
        message = `The ${legalEntity} CLA could not be enabled for the repo ${repoName} using the notification e-mail address(es) ${claMail}`;
      }
      const result = {
        error: enableClaError,
        message: message,
      };
      callback(null, result);
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
  if (pendingRequest.claMail && pendingRequest.claEntity) {
    tasks.push(createSetLegacyClaTask(org, repoName, pendingRequest.claEntity, pendingRequest.claMail));
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
  org.createRepository(self.request.repoName, properties, function (error, newRepoDetails) {
    if (error) {
      error = utils.wrapError(error, `The GitHub API did not allow the creation of the new repo. ${error.message}`);
      return callback(error);
    }
    // Adding a 3-second delay to see if this fixes the underlying GH issues or not
    setTimeout(() => {
      callback(null, newRepoDetails);
    }, 3000);
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
  req.legacyUserContext.addBreadcrumb(req, 'Approvals');
  next();
});

router.get('/', function (req, res, next) {
  var team = req.team2;
  team.getApprovals(function (error, approvals) {
    if (error) {
      return next(error);
    }
    req.legacyUserContext.render(req, res, 'org/team/approvals', 'Approvals for ' + team.name, {
      team: team,
      pendingApprovals: approvals,
      teamUrl: req.teamUrl,
    });
  });
});

router.use('/:requestid', function (req, res, next) {
  var team = req.team2;
  var requestid = req.params.requestid;
  var dc = req.app.settings.dataclient;
  const operations = req.app.settings.providers.operations;
  dc.getApprovalRequest(requestid, function (error, pendingRequest) {
    if (error) {
      return next(utils.wrapError(error, 'The pending request you are looking for does not seem to exist.'));
    }
    operations.getAccountWithDetailsAndLink(pendingRequest.ghid, (getAccountError, requestingUserAccount) => {
      if (getAccountError) {
        return next(getAccountError);
      }
      const approvalPackage = {
        request: pendingRequest,
        requestingUser: requestingUserAccount,
        id: requestid,
      };
      createRequestEngine(team, approvalPackage, function (error, engine) {
        if (error) {
          return next(error);
        }
        req.legacyUserContext.addBreadcrumb(req, engine.typeName + ' Request');
        req.approvalEngine = engine;
        next();
      });
    });
  });
});

// Pass on to the context-specific routes.
router.use('/:requestid', approvalRoute);

module.exports = router;
