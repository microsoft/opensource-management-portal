//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import express from 'express';
import asyncHandler from 'express-async-handler';
const router = express.Router();

import async from 'async';

import { IReposError, ReposAppRequest, IProviders } from '../../transitional';
import { IApprovalProvider } from '../../entities/teamJoinApproval/approvalProvider';
import { TeamJoinApprovalEntity } from '../../entities/teamJoinApproval/teamJoinApproval';
import { safeLocalRedirectUrl, asNumber } from '../../utils';
import { Operations } from '../../business/operations';
import { Team } from '../../business/team';
import { Organization } from '../../business/organization';
import { IAggregateUserTeams } from '../../user/aggregate';

interface ApprovalPair {
  team: Team;
  request: TeamJoinApprovalEntity;
}

async function getTeamMaintainerApprovals(operations: Operations, aggregateTeams: IAggregateUserTeams, approvalProvider: IApprovalProvider): Promise<ApprovalPair[]> {
  // TODO: move to team object?
  const ownedTeamIdsAsStrings = aggregateTeams.maintainer.map(team => team.id.toString());
  if (ownedTeamIdsAsStrings.length === 0) {
    return [];
  }
  const pendingApprovals = await approvalProvider.queryPendingApprovalsForTeams(ownedTeamIdsAsStrings);
  const pairs: ApprovalPair[] = [];
  for (const request of pendingApprovals) {
    try {
      const pair = await hydrateRequest(operations, request);
      if (pair) {
        pairs.push(pair);
      }
    } catch (ignored) { /* ignored */ }
  }
  return pairs;
}

async function hydrateRequest(operations: Operations, request: TeamJoinApprovalEntity): Promise<ApprovalPair> {
  const teamIdAsNumber = asNumber(request.teamId);
  const organizationName = request.organizationName;
  const team = operations.getTeamByIdWithOrganization(teamIdAsNumber, organizationName);
  await team.getDetails();
  if (team && team.name) {
    return { team, request };
  }
}

async function getUserRequests(operations: Operations, thirdPartyIdAsString: string, approvalProvider: IApprovalProvider): Promise<ApprovalPair[]> {
  const pendingApprovals = await approvalProvider.queryPendingApprovalsForThirdPartyId(thirdPartyIdAsString);
  const pairs: ApprovalPair[] = [];
  for (const request of pendingApprovals) {
    try {
      const pair = await hydrateRequest(operations, request);
      if (pair) {
        pairs.push(pair);
      }
    } catch (ignored) { /* ignored */ }
  }
  return pairs;
}

router.get('/', asyncHandler(async function (req: ReposAppRequest, res, next) {
  const operations = req.app.settings.providers.operations as Operations;
  const approvalProvider = req.app.settings.providers.approvalProvider as IApprovalProvider;
  if (!approvalProvider) {
    return next(new Error('No approval provider instance available'));
  }
  req.individualContext.webContext.pushBreadcrumb('Requests');
  // CONSIDER: Requests on GitHub.com should be shown, too, now that that's integrated in many cases
  const id = req.individualContext.getGitHubIdentity().id;
  const aggregateTeams = await req.individualContext.aggregations.teams();
  const state = {
    teamResponsibilities: await getTeamMaintainerApprovals(operations, aggregateTeams, approvalProvider),
    usersRequests: await getUserRequests(operations, id.toString(), approvalProvider),
  };
  req.individualContext.webContext.render({
    view: 'settings/approvals',
    title: 'Review My Approvals',
    state,
  });
}));

router.post('/:requestid/cancel', function (req: ReposAppRequest, res, next) {
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
        return res.redirect(safeReturnUrl || '/settings/approvals/');
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
  let pendingRequest: TeamJoinApprovalEntity = null;
  let team2: Team = null;
  let maintainers = null;
  const username = req.individualContext.getGitHubIdentity().username;
  const id = req.individualContext.getGitHubIdentity().id;
  let organization: Organization = null;
  async.waterfall([
    function (callback) {
      approvalProvider.getApprovalEntity(requestid).then(entry => {
        return callback(null, entry);
      }).catch(error => {
        return callback(error);
      });
    },
    function (pendingRequestValue: TeamJoinApprovalEntity) {
      var callback = arguments[arguments.length - 1];
      pendingRequest = pendingRequestValue;
      if (!pendingRequest.organizationName) {
        // TODO: Need to make sure 'org' is _always_ provided going forward
        // XXX
        return callback(new Error('No organization information stored alongside the request'));
      }
      organization = operations.getOrganization(pendingRequest.organizationName);
      team2 = organization.team(asNumber(pendingRequest.teamId));
      team2.getDetails().then(ok => {
        return organization.isSudoer(username).then(result => {
          return callback(null, result);
        }).catch(callback);
      }).catch(getDetailsError => {
          return callback(getDetailsError);
      });
    },
    function (isOrgSudoer: boolean, callback) {
      isMaintainer = isOrgSudoer;
      team2.getOfficialMaintainers().then(maints => {
        return callback(null, maints);
      }).catch(callback);
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
      if (pendingRequest.thirdPartyId != /* loose */ id) {
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
  const operations = providers.operations as Operations;
  const organization = operations.getOrganization(pendingRequest.org);
  const config = req.app.settings.runtimeConfig;
  const repoApprovalTypesValues = config.github.approvalTypes.repo;
  if (repoApprovalTypesValues.length === 0) {
    return next(new Error('No repo approval providers configured.'));
  }
  const repoApprovalTypes = new Set(repoApprovalTypesValues);
  const mailProviderInUse = repoApprovalTypes.has('mail');
  if (!mailProviderInUse) {
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
    return res.redirect('/');
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
