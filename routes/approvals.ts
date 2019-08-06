//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

// TODO: BEFORE PROD: this is out of date and still using legacy context

import express = require('express');
const router = express.Router();

import async = require('async');

import { IReposError, ReposAppRequest, IProviders } from '../transitional';
import { IApprovalProvider } from '../entities/teamJoinApproval/approvalProvider';
import { TeamJoinApprovalEntity } from '../entities/teamJoinApproval/teamJoinApproval';
import { safeLocalRedirectUrl } from '../utils';

router.get('/', function (req: ReposAppRequest, res, next) {
  const operations = req.app.settings.providers.operations;
  const approvalProvider = req.app.settings.providers.approvalProvider as IApprovalProvider;
  if (!approvalProvider) {
    return next(new Error('No approval provider instance available'));
  }

  req.individualContext.webContext.pushBreadcrumb('Requests');
  // CONSIDER: Requests on GitHub.com should be shown, too, now that that's integrated in many cases
  const id = req.individualContext.getGitHubIdentity().id;
  operations.getUserContext(id).getAggregatedOverview((overviewWarning, overview) => {
    if (overviewWarning) {
      return next(overviewWarning);
    }
    async.parallel({
      ownedTeams: function (callback) {
        const ownedTeams = overview.teams.maintainer;
        if (ownedTeams && ownedTeams.length && ownedTeams.length > 0) {
          approvalProvider.queryPendingApprovalsForTeams(ownedTeams).catch(getPendingApprovalsError => {
            return callback(getPendingApprovalsError);
          }).then((appvs: any) => {
            async.each(appvs, function (approval: any, cb) {
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
        approvalProvider.queryPendingApprovalsForThirdPartyId(id).catch(error => {
          return callback(error);
        }).then((approvals: any) => {
          return callback(null, approvals);
        });
      }
    }, function (error, results) {
      if (error) {
        return next(error);
      }
      async.each(results.requestsUserMade as any, function (request: TeamJoinApprovalEntity, cb) {
        const teamFromRequest = request.teamId;
        if (teamFromRequest) {
          operations.getTeamById(teamFromRequest, (err, teamInstance) => {
            request['_teamInstance'] = teamInstance; // hack, directly storing instance on top
            cb(err);
          });
        } else {
          cb();
        }
      }, function (error) {
        if (error) {
          return next(error);
        }
        req.individualContext.webContext.render({
          view: 'org/approvals',
          title: 'Review My Approvals',
          state: {
            teamResponsibilities: results.ownedTeams,
            usersRequests: results.requestsUserMade,
          },
        });
      });
    });
  });
});

router.post('/:requestid/cancel', function (req: ReposAppRequest, res, next) {
  const operations = req.app.settings.providers.operations;
  const approvalProvider = req.app.settings.providers.approvalProvider as IApprovalProvider;
  if (!approvalProvider) {
    return next(new Error('No approval provider instance available'));
  }
  const safeReturnUrl = safeLocalRedirectUrl(req.body.returnUrl || req.params.returnUrl);
  const requestid = req.params.requestid;
  const id = req.individualContext.getGitHubIdentity().id;
  approvalProvider.getApprovalEntity(requestid).catch(error => {
    return next(new Error('The pending request you are looking for does not seem to exist.'));
  }).then((pendingRequest: TeamJoinApprovalEntity) => {
    if (pendingRequest.thirdPartyId == id) {
      pendingRequest.active = false;
      pendingRequest.decisionMessage = 'canceled-by-user';
      pendingRequest.decisionTime = new Date(); // (new Date().getTime()).toString();
      approvalProvider.updateTeamApprovalEntity(pendingRequest).catch(error => {
        if (error) {
          return next(error);
        }
      }).then(unused => {
        return res.redirect(safeReturnUrl || '/approvals/');
      });
    } else {
      return next(new Error('You are not authorized to cancel this request.'));
    }
  });
});

router.get('/:requestid', function (req: ReposAppRequest, res, next) {
  const requestid = req.params.requestid;
  const providers = req.app.settings.providers as IProviders;
  const operations = providers.operations;
  const approvalProvider = providers.approvalProvider;
  req.individualContext.webContext.pushBreadcrumb('Your Request');
  let isMaintainer = false;
  let pendingRequest = null;
  let team2 = null;
  let maintainers = null;
  const username = req.individualContext.getGitHubIdentity().username;
  const id = req.individualContext.getGitHubIdentity().id;
  let organization = null;
  async.waterfall([
    function (callback) {
      approvalProvider.getApprovalEntity(requestid).then(entry => {
        return callback(null, entry);
      }).catch(error => {
        return callback(error);
      });
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
        let err: IReposError = new Error('Redirecting to the admin experience to approve');
        let slugPreferred = team2.slug || team2.name;
        err.redirect = '/' + organization.name + '/teams/' + slugPreferred + '/approvals/' + requestid;
        return callback(err);
      }
      if (pendingRequest.ghid != id) {
        let msg: IReposError = new Error('This request does not exist or was created by another user.');
        msg.skipLog = true;
        return callback(msg);
      }
      callback();
    }
  ], function (error: any) {
    if (error) {
      if (error.redirect) {
        return res.redirect(error.redirect);
      }
      // Edge case: the team no longer exists.
      if (error.innerError && error.innerError.innerError && error.innerError.innerError.statusCode == 404) {
        return closeOldRequest(pendingRequest, req, res, next);
      }
      return next(error);
    } else {
      if (pendingRequest.decisionTime) {
        let asInt = parseInt(pendingRequest.decisionTime, 10);
        pendingRequest.decisionTime = new Date(asInt);
      }
      req.individualContext.webContext.render({
        view: 'org/userApprovalStatus',
        title: 'Review your request',
        state: {
          entry: pendingRequest,
          team: team2,
        },
      });
    }
  });
});

function closeOldRequest(pendingRequest, req: ReposAppRequest, res, next) {
  const providers = req.app.settings.providers as IProviders;
  const operations = providers.operations;
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
  req.individualContext.webContext.saveUserAlert('The team this request was for no longer exists. The request has been canceled.', 'Team gone!', 'success');
  if (pendingRequest.active === false) {
    return res.redirect('/');
  }
  const approvalProvider = providers.approvalProvider;
  closeRequest(approvalProvider, pendingRequest.RowKey, 'Team no longer exists.', (closeError) => {
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

function closeRequest(approvalProvider: IApprovalProvider, requestid: string, note: string, callback) {
  approvalProvider.getApprovalEntity(requestid).then(pendingRequest => {
    pendingRequest.active = false;
    pendingRequest.decisionMessage = note;
    return approvalProvider.updateTeamApprovalEntity(pendingRequest).then(ok => {
      return callback(null, ok);
    });
  }).catch(error => {
    return callback(error);
  });
}

module.exports = router;
