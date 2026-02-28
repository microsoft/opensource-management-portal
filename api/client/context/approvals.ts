//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { NextFunction, Response, Router } from 'express';

import { Team, Organization } from '../../../business/index.js';
import { TeamJoinApprovalEntity } from '../../../business/entities/teamJoinApproval/teamJoinApproval.js';
import { TeamJsonFormat, ReposAppRequest } from '../../../interfaces/index.js';
import { jsonError } from '../../../middleware/index.js';
import {
  ApprovalPair,
  Approvals_getTeamMaintainerApprovals,
  Approvals_getUserRequests,
  closeOldRequest,
} from '../../../routes/settings/approvals.js';
import { getProviders } from '../../../lib/transitional.js';
import { IndividualContext } from '../../../business/user/index.js';

const router: Router = Router();

const approvalPairToJson = (pair: ApprovalPair) => {
  return {
    request: pair.request,
    team: pair.team.asJson(TeamJsonFormat.Augmented),
  };
};

router.get('/', async (req: ReposAppRequest, res: Response, next: NextFunction) => {
  const { approvalProvider, operations } = getProviders(req);
  const activeContext = (req.individualContext || req.apiContext) as IndividualContext;
  if (!activeContext.link) {
    return res.json({
      teamResponsibilities: [],
      usersRequests: [],
      isLinked: false,
    }) as unknown as void;
  }
  try {
    // const username = activeContext.getGitHubIdentity().username;
    const id = activeContext.getGitHubIdentity().id;
    const aggregateTeams = await activeContext.aggregations.teams();
    const teamResponsibilities = await Approvals_getTeamMaintainerApprovals(
      operations,
      aggregateTeams,
      approvalProvider
    );
    const usersRequests = await Approvals_getUserRequests(operations, id.toString(), approvalProvider);
    const state = {
      teamResponsibilities: teamResponsibilities.map(approvalPairToJson),
      usersRequests: usersRequests.map(approvalPairToJson),
    };
    return res.json(state) as unknown as void;
  } catch (error) {
    return next(jsonError(error));
  }
});

// -- individual request

router.get('/:approvalId', async (req: ReposAppRequest, res: Response, next: NextFunction) => {
  const approvalId = req.params.approvalId;
  const activeContext = (req.individualContext || req.apiContext) as IndividualContext;
  if (!activeContext.link) {
    return res.json({});
  }
  const { insights } = activeContext;
  const { approvalProvider, operations } = getProviders(req);
  const corporateId = activeContext.corporateIdentity.id;
  let request: TeamJoinApprovalEntity = null;
  try {
    let isMaintainer = false;
    let team: Team = null;
    const username = activeContext.getGitHubIdentity().username;
    const id = activeContext.getGitHubIdentity().id;
    let organization: Organization = null;
    request = await approvalProvider.getApprovalEntity(approvalId);
    organization = operations.getOrganization(request.organizationName);
    team = organization.team(Number(request.teamId));
    await team.getDetails();
    if (corporateId === request.corporateId) {
      return res.json(approvalPairToJson({ request, team }));
    }
    const isPortalSudoer = await operations.isPortalSudoer(insights, username, activeContext.link);
    const isOrgSudoer = isPortalSudoer || (await organization.isSudoer(username, activeContext.link));
    isMaintainer = isPortalSudoer || isOrgSudoer;
    const maintainers = await team.getOfficialMaintainers();
    if (!isMaintainer) {
      for (let i = 0; i < maintainers.length; i++) {
        if (String(maintainers[i].id) == String(id)) {
          isMaintainer = true;
        }
      }
    }
    if (isMaintainer) {
      return res.json(approvalPairToJson({ request, team }));
    }
    throw jsonError('This request does not exist or was created by another user', 400);
  } catch (error) {
    // Edge case: the team no longer exists.
    if (error?.cause?.statusCode === 404 || error?.cause?.cause?.statusCode === 404) {
      return closeOldRequest(true, request, req, res, next);
    }
    return next(jsonError(error));
  }
});

router.use('/*splat', (req: ReposAppRequest, res: Response, next: NextFunction) => {
  return next(jsonError('Contextual API or route not found within approvals', 404));
});

export default router;
