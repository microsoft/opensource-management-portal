//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

const express = require('express');
const router = express.Router();
const async = require('async');
const utils = require('../utils');

router.get('/', function (req, res, next) {
  var dc = req.app.settings.dataclient;
  var oss = req.oss;
  req.legacyUserContext.addBreadcrumb(req, 'Requests');
  async.parallel({
    ownedTeams: function (callback) {
      oss.getMyTeamMemberships('maintainer', function (getTeamMembershipsError, ownedTeams) {
        if (getTeamMembershipsError) {
          return callback(getTeamMembershipsError);
        }
        if (ownedTeams && ownedTeams.length && ownedTeams.length > 0) {
          dc.getPendingApprovals(ownedTeams, function (getPendingApprovalsError, appvs) {
            if (getPendingApprovalsError) {
              return callback(getPendingApprovalsError);
            }
            async.each(appvs, function (approval, cb) {
              var teamFromRequest = approval.teamid;
              if (teamFromRequest) {
                oss.getTeam(teamFromRequest, function (getTeamError, teamInstance) {
                  approval._teamInstance = teamInstance;
                  cb(getTeamError);
                });
              } else {
                cb();
              }
            }, function (iterationError) {
              callback(iterationError, appvs);
            });
          });
        } else {
          callback();
        }
      });
    },
    requestsUserMade: function (callback) {
      // CONSIDER: Need to hydrate with _teamInstance just like above...
      dc.getPendingApprovalsForUserId(oss.id.github, callback);
    }
  }, function (error, results) {
    if (error) {
      return next(error);
    }
    async.each(results.requestsUserMade, function (request, cb) {
      var teamFromRequest = request.teamid;
      if (teamFromRequest) {
        oss.getTeam(teamFromRequest, function (err, teamInstance) {
          request._teamInstance = teamInstance;
          cb(err);
        });
      } else {
        cb();
      }
    }, function (error) {
      if (error) {
        return next(error);
      }
      req.legacyUserContext.render(req, res, 'org/approvals', 'Review My Approvals', {
        teamResponsibilities: results.ownedTeams,
        usersRequests: results.requestsUserMade,
      });
    });
  });
});

router.post('/:requestid/cancel', function (req, res, next) {
  var oss = req.oss;
  var dc = req.app.settings.dataclient;
  var requestid = req.params.requestid;
  dc.getApprovalRequest(requestid, function (error, pendingRequest) {
    if (error) {
      return next(new Error('The pending request you are looking for does not seem to exist.'));
    }
    if (pendingRequest.ghid == oss.id.github) {
      dc.updateApprovalRequest(requestid, {
        active: false,
        decision: 'canceled-by-user',
        decisionTime: (new Date().getTime()).toString()
      }, function (error) {
        if (error) {
          return next(error);
        }
        oss.getTeam(pendingRequest.teamid, function (error, team) {
          if (error) {
            return next(utils.wrapError(error, 'We could not get an instance of the team.'));
          }
          // Return the user now no matter what
          res.redirect('/approvals/');

          // Attempt to do more in the case that an issue exists - regardless of configured providers for requests
          if (!pendingRequest.issue) {
            return;
          }

          var workflowRepo = null;
          try {
            // ::: legacyNotificationsRepository is the new org value
            workflowRepo = team2.organization.legacyNotificationsRepository;
          } catch (noWorkflowError) {
            // OK, give up
            return;
          }

          var trackingIssue = workflowRepo.issue(pendingRequest.issue);
          trackingIssue.createComment('This request was canceled by ' + oss.usernames.github + ' via the open source portal and can be ignored.', function (/* ignoredError */) {
            // We ignore any error from the comment field, since that isn't the important part...
            trackingIssue.close(function (/* ignored error */) {
              /* nothing */
            });
          });
        });
      });
    } else {
      return next(new Error('You are not authorized to cancel this request.'));
    }
  });
});

router.get('/:requestid', function (req, res, next) {
  var requestid = req.params.requestid;
  const operations = req.app.settings.providers.operations;
  var dc = oss.dataClient();
  req.legacyUserContext.addBreadcrumb(req, 'Your Request');
  let isMaintainer = false;
  let pendingRequest = null;
  let team2 = null;
  let maintainers = null;
  const username = req.legacyUserContext.usernames.github;
  const id = req.legacyUserContext.id.github;
  async.waterfall([
    function (callback) {
      dc.getApprovalRequest(requestid, callback);
    },
    function (pendingRequestValue) {
      var callback = arguments[arguments.length - 1];
      pendingRequest = pendingRequestValue;
      if (!pendingRequest.org) {
        // TODO: Need to make sure 'org' is _always_ provided going forward
        // XXX
        return callback(new Error('No organization information stored alongside the request'));
      }
      const organization = operations.getOrganization(pendingRequest.org);
      team2 = organization.team(pendingRequest.teamid);
      team2.getDetails(getDetailsError => {
        if (getDetailsError) {
          return callback(getDetailsError);
        }
        return organization.isSudoer(username, callback);
      });
    },
    function (isOrgSudoer, callback) {
      isMaintainer = isOrgSudoer;
      team2.getOfficialMaintainers(callback);
    },
    function (maintainersValue, callback) {
      maintainers = maintainersValue;
      if (!isMaintainer) {
        for (var i = 0; i < maintainers.length; i++) {
          if (maintainers[i].id == id) {
            isMaintainer = true;
          }
        }
      }
      if (isMaintainer) {
        let err = new Error('Redirecting to the admin experience to approve');
        let slugPreferred = team2.slug || team2.name;
        err.redirect = '/' + organization.name + '/teams/' + slugPreferred + '/approvals/' + requestid;
        return callback(err);
      }
      if (pendingRequest.ghid != oss.id.github) {
        let msg = new Error('This request does not exist or was created by another user.');
        msg.skipLog = true;
        return callback(msg);
      }
      callback();
    }
  ], function (error) {
    if (error) {
      if (error.redirect) {
        return res.redirect(error.redirect);
      }
      // Edge case: the team no longer exists.
      if (error.innerError && error.innerError.innerError && error.innerError.innerError.statusCode == 404) {
        let dc = req.app.settings.dataclient;
        return closeOldRequest(dc, oss, pendingRequest, req, res, next);
      }
      return next(error);
    } else {
      if (pendingRequest.decisionTime) {
        let asInt = parseInt(pendingRequest.decisionTime, 10);
        pendingRequest.decisionTime = new Date(asInt);
      }
      req.legacyUserContext.render(req, res, 'org/userApprovalStatus', 'Review your request', {
        entry: pendingRequest,
        team: team2,
      });
    }
  });
});

function closeOldRequest(dc, oss, pendingRequest, req, res, next) {
  var org = oss.org(pendingRequest.org);
  const organization = new Error('TBI');
  // xxxx
  const config = req.app.settings.runtimeConfig;
  const repoApprovalTypesValues = config.github.approvalTypes.repo;
  if (repoApprovalTypesValues.length === 0) {
    return next(new Error('No repo approval providers configured.'));
  }
  const repoApprovalTypes = new Set(repoApprovalTypesValues);
  const mailProviderInUse = repoApprovalTypes.has('mail');
  var issueProviderInUse = repoApprovalTypes.has('github');
  if (!mailProviderInUse && !issueProviderInUse) {
    return next(new Error('No configured approval providers configured.'));
  }
  oss.saveUserAlert(req, 'The team this request was for no longer exists. The request has been canceled.', 'Team gone!', 'success');
  if (pendingRequest.active === false) {
    return res.redirect('/');
  }
  closeRequest(dc, pendingRequest.RowKey, 'Team no longer exists.', (closeError) => {
    if (closeError) {
      return next(closeError);
    }
    var notificationRepo = null;
    try {
      // legacyNotificationsRepository is the new value
      notificationRepo = organization.legacyNotificationsRepository;
    } catch (noWorkflowRepoError) {
      issueProviderInUse = false;
    }
    if (!issueProviderInUse) {
      return res.redirect('/');
    }
    const issue = notificationRepo.issue(pendingRequest.issue);
    issue.createComment('The team no longer exists on GitHub. This issue is being cancelled.', function (commentError) {
      if (commentError) {
        next(commentError);
      }
      // Attempt to close the issue even if commenting failed
      issue.close(function (closeError) {
        if (!commentError &&  closeError) {
          return next(closeError);
        }
        if (!commentError) {
          res.redirect('/');
        }
      });
    });
  });
}

function closeRequest(dc, rowKey, note, callback) {
  dc.updateApprovalRequest(rowKey, {
    active: false,
    decisionNote: note,
  }, callback);
}

module.exports = router;
