//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

const express = require('express');
const router = express.Router();
const async = require('async');

router.get('/', function (req, res, next) {
  const dc = req.app.settings.dataclient;
  const operations = req.app.settings.providers.operations;
  const legacyUserContext = req.legacyUserContext;
  legacyUserContext.addBreadcrumb(req, 'Requests');
  // CONSIDER: Requests on GitHub.com should be shown, too, now that that's integrated in many cases
  const id = req.legacyUserContext.id.github;
  operations.getUserContext(id).getAggregatedOverview((overviewWarning, overview) => {
    if (overviewWarning) {
      return next(overviewWarning);
    }
    async.parallel({
      ownedTeams: function (callback) {
        const ownedTeams = overview.teams.maintainer;
        if (ownedTeams && ownedTeams.length && ownedTeams.length > 0) {
          dc.getPendingApprovals(ownedTeams, function (getPendingApprovalsError, appvs) {
            if (getPendingApprovalsError) {
              return callback(getPendingApprovalsError);
            }
            async.each(appvs, function (approval, cb) {
              const teamFromRequest = approval.teamid;
              if (teamFromRequest) {
                const requestTeamId = parseInt(teamFromRequest, 10);
                operations.getTeamById(requestTeamId, (getTeamError, teamInstance) => {
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
      },
      requestsUserMade: function (callback) {
        // CONSIDER: Need to hydrate with _teamInstance just like above...
        dc.getPendingApprovalsForUserId(id, callback);
      }
    }, function (error, results) {
      if (error) {
        return next(error);
      }
      async.each(results.requestsUserMade, function (request, cb) {
        var teamFromRequest = request.teamid;
        if (teamFromRequest) {
          operations.getTeamById(teamFromRequest, (err, teamInstance) => {
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
});

router.post('/:requestid/cancel', function (req, res, next) {
  const dc = req.app.settings.dataclient;
  const requestid = req.params.requestid;
  const id = req.legacyUserContext.id.github;
  dc.getApprovalRequest(requestid, function (error, pendingRequest) {
    if (error) {
      return next(new Error('The pending request you are looking for does not seem to exist.'));
    }
    if (pendingRequest.ghid == id) {
      dc.updateApprovalRequest(requestid, {
        active: false,
        decision: 'canceled-by-user',
        decisionTime: (new Date().getTime()).toString()
      }, function (error) {
        if (error) {
          return next(error);
        }
        return res.redirect('/approvals/');
      });
    } else {
      return next(new Error('You are not authorized to cancel this request.'));
    }
  });
});

router.get('/:requestid', function (req, res, next) {
  const requestid = req.params.requestid;
  const operations = req.app.settings.providers.operations;
  const dc = operations.dataClient;
  const legacyUserContext = req.legacyUserContext;
  legacyUserContext.addBreadcrumb(req, 'Your Request');
  let isMaintainer = false;
  let pendingRequest = null;
  let team2 = null;
  let maintainers = null;
  const username = req.legacyUserContext.usernames.github;
  const id = req.legacyUserContext.id.github;
  let organization = null;
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
      organization = operations.getOrganization(pendingRequest.org);
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
      if (pendingRequest.ghid != id) {
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
        return closeOldRequest(dc, legacyUserContext, pendingRequest, req, res, next);
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

function closeOldRequest(dc, legacyUserContext, pendingRequest, req, res, next) {
  const operations = req.app.settings.providers.operations;
  const organization = operations.getOrganization(pendingRequest.org);
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
  legacyUserContext.saveUserAlert(req, 'The team this request was for no longer exists. The request has been canceled.', 'Team gone!', 'success');
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
