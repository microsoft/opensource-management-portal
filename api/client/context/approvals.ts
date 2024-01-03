//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { NextFunction, Response, Router } from 'express';
import asyncHandler from 'express-async-handler';

import { Team, Organization } from '../../../business';
import { TeamJoinApprovalEntity } from '../../../business/entities/teamJoinApproval/teamJoinApproval';
import { TeamJsonFormat, ReposAppRequest } from '../../../interfaces';
import { jsonError } from '../../../middleware';
import {
  ApprovalPair,
  Approvals_getTeamMaintainerApprovals,
  Approvals_getUserRequests,
  closeOldRequest,
} from '../../../routes/settings/approvals';
import { getProviders } from '../../../lib/transitional';
import { IndividualContext } from '../../../business/user';

const router: Router = Router();

const approvalPairToJson = (pair: ApprovalPair) => {
  return {
    request: pair.request,
    team: pair.team.asJson(TeamJsonFormat.Augmented),
  };
};

router.get(
  '/',
  asyncHandler(async (req: ReposAppRequest, res: Response, next: NextFunction) => {
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
  })
);

// -- individual request

router.get(
  '/:approvalId',
  asyncHandler(async (req: ReposAppRequest, res: Response, next: NextFunction) => {
    const approvalId = req.params.approvalId;
    const activeContext = (req.individualContext || req.apiContext) as IndividualContext;
    if (!activeContext.link) {
      return res.json({});
    }
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
      const isPortalSudoer = await operations.isPortalSudoer(username, activeContext.link);
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
  })
);

router.use('*', (req: ReposAppRequest, res: Response, next: NextFunction) => {
  return next(jsonError('Contextual API or route not found within approvals', 404));
});

export default router;
