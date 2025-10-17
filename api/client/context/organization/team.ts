//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { NextFunction, Response, Router } from 'express';

import { TeamJoinApprovalEntity } from '../../../../business/entities/teamJoinApproval/teamJoinApproval.js';
import {
  ReposAppRequest,
  OrganizationMembershipState,
  ITeamMembershipRoleState,
  GitHubTeamRole,
} from '../../../../interfaces/index.js';
import { IGraphEntry } from '../../../../lib/graphProvider/index.js';
import { jsonError } from '../../../../middleware/index.js';
import {
  AddTeamMembershipToRequest,
  AddTeamPermissionsToRequest,
  getContextualTeam,
  getTeamMembershipFromRequest,
  getTeamPermissionsFromRequest,
} from '../../../../middleware/github/teamPermissions.js';
import { submitTeamJoinRequest } from '../../../../routes/org/team/index.js';
import { postActionDecision, TeamApprovalDecision } from '../../../../routes/org/team/approval/index.js';
import { PermissionWorkflowEngine } from '../../../../routes/org/team/approvals.js';
import { CreateError, getProviders } from '../../../../lib/transitional.js';
import { IndividualContext } from '../../../../business/user/index.js';
import getCompanySpecificDeployment from '../../../../middleware/companySpecificDeployment.js';

const router: Router = Router();

interface ITeamRequestJsonResponse {
  request?: TeamJoinApprovalEntity;
}

interface ITeamApprovalsJsonResponse {
  allowAdministration: boolean;
  approvals?: TeamJoinApprovalEntity[];
}

router.get(
  '/permissions',
  AddTeamPermissionsToRequest,
  AddTeamMembershipToRequest,
  async (req: ReposAppRequest, res: Response, next: NextFunction) => {
    const membership = getTeamMembershipFromRequest(req);
    const permissions = getTeamPermissionsFromRequest(req);
    return res.json({ permissions, membership }) as unknown as void;
  }
);

router.get('/join/request', async (req: ReposAppRequest, res: Response, next: NextFunction) => {
  const { approvalProvider } = getProviders(req);
  const team = getContextualTeam(req);
  const activeContext = (req.individualContext || req.apiContext) as IndividualContext;
  let request: TeamJoinApprovalEntity = null;
  if (activeContext.link) {
    // no point query currently implemented
    let approvals = await approvalProvider.queryPendingApprovalsForTeam(String(team.id));
    approvals = approvals.filter((approval) => approval.corporateId === activeContext.corporateIdentity.id);
    request = approvals.length > 0 ? approvals[0] : null;
  }
  const response: ITeamRequestJsonResponse = { request };
  return res.json(response) as unknown as void;
});

router.post(
  '/join',
  AddTeamMembershipToRequest,
  async (req: ReposAppRequest, res: Response, next: NextFunction) => {
    try {
      const providers = getProviders(req);
      const { approvalProvider } = providers;
      const membership = getTeamMembershipFromRequest(req);
      if (!membership.isLinked) {
        return res.json({
          error: 'You have not linked your GitHub account to your corporate identity yet',
        }) as unknown as void;
      }
      if (membership.membershipState === OrganizationMembershipState.Active) {
        return res.json({ error: 'You already have an active team membership' }) as unknown as void;
      }
      const team = getContextualTeam(req);
      const activeContext = (req.individualContext || req.apiContext) as IndividualContext;
      const companySpecific = getCompanySpecificDeployment();
      if (companySpecific?.middleware?.teamPermissions.beforeJoinRequest) {
        try {
          const optionalOutcome = await companySpecific.middleware.teamPermissions.beforeJoinRequest(
            providers,
            activeContext,
            team
          );
          if (optionalOutcome) {
            return res.json(optionalOutcome) as unknown as void;
          }
        } catch (error) {
          return next(error);
        }
      }
      // no point query currently implemented
      let approvals = await approvalProvider.queryPendingApprovalsForTeam(String(team.id));
      approvals = approvals.filter((approval) => approval.corporateId === activeContext.corporateIdentity.id);
      const request = approvals.length > 0 ? approvals[0] : null;
      if (request) {
        return res.json({ error: 'You already have a pending team join request' }) as unknown as void;
      }
      //
      const justification = (req.body.justification || '') as string;
      const hostname = req.hostname;
      const correlationId = req.correlationId;
      const outcome = await submitTeamJoinRequest(
        providers,
        activeContext,
        team,
        justification,
        correlationId,
        hostname
      );
      return res.json(outcome) as unknown as void;
    } catch (error) {
      return next(jsonError(error));
    }
  }
);

router.post(
  '/join/approvals/:approvalId',
  AddTeamPermissionsToRequest,
  async (req: ReposAppRequest, res: Response, next: NextFunction) => {
    const { approvalId: id } = req.params;
    if (!id) {
      return next(CreateError.InvalidParameters('invalid approval'));
    }
    const permissions = getTeamPermissionsFromRequest(req);
    if (!permissions.allowAdministration) {
      return next(CreateError.NotAuthorized('you do not have permission to administer this team'));
    }
    const providers = getProviders(req);
    const { approvalProvider, operations } = providers;
    const team = getContextualTeam(req);
    const request = await approvalProvider.getApprovalEntity(id);
    if (String(request.teamId) !== String(team.id)) {
      return next(CreateError.InvalidParameters('mismatch on team'));
    }
    const requestingUser = await operations.getAccountWithDetailsAndLink(request.thirdPartyId);
    const approvalPackage = { request, requestingUser, id };
    const engine = new PermissionWorkflowEngine(team, approvalPackage);
    const activeContext = (req.individualContext || req.apiContext) as IndividualContext;
    const text = req.body.text as string;
    const dv = req.body.decision as string;
    let decision: TeamApprovalDecision = null;
    switch (dv) {
      case 'approve':
        decision = TeamApprovalDecision.Approve;
        break;
      case 'deny':
        decision = TeamApprovalDecision.Deny;
        break;
      case 'reopen':
        decision = TeamApprovalDecision.Reopen;
        break;
      default:
        return next(CreateError.InvalidParameters('invalid or no decision type'));
    }
    const teamBaseUrl = `/orgs/${team.organization.name}/teams/${team.slug}/`; // trailing?
    try {
      const outcome = await postActionDecision(providers, activeContext, engine, teamBaseUrl, decision, text);
      if (outcome.error) {
        throw outcome.error;
      }
      return res.json(outcome) as unknown as void;
    } catch (outcomeError) {
      return next(CreateError.ServerError(outcomeError));
    }
  }
);

router.get(
  '/join/approvals/:approvalId',
  AddTeamPermissionsToRequest,
  async (req: ReposAppRequest, res: Response, next: NextFunction) => {
    const { approvalId: id } = req.params;
    if (!id) {
      return next(CreateError.InvalidParameters('invalid approval'));
    }
    const permissions = getTeamPermissionsFromRequest(req);
    if (!permissions.allowAdministration) {
      return next(CreateError.NotAuthorized('you do not have permission to administer this team'));
    }
    const providers = getProviders(req);
    const { approvalProvider, graphProvider } = providers;
    const team = getContextualTeam(req);
    const request = await approvalProvider.getApprovalEntity(id);
    if (String(request.teamId) !== String(team.id)) {
      return next(CreateError.InvalidParameters('mismatch on team'));
    }
    let management: IGraphEntry[] = null;
    if (request?.corporateId) {
      try {
        management = await graphProvider.getManagementChain(request.corporateId);
      } catch (error) {
        // we ignore any failure here, this is an optional value-add for now
      }
    }
    return res.json({ approval: request, management }) as unknown as void;
  }
);

router.get(
  '/join/approvals',
  AddTeamPermissionsToRequest,
  async (req: ReposAppRequest, res: Response, next: NextFunction) => {
    const { approvalProvider } = getProviders(req);
    const team = getContextualTeam(req);
    const permissions = getTeamPermissionsFromRequest(req);
    const response: ITeamApprovalsJsonResponse = {
      allowAdministration: false,
    };
    if (permissions.allowAdministration) {
      response.allowAdministration = permissions.allowAdministration;
      response.approvals = await approvalProvider.queryPendingApprovalsForTeam(String(team.id));
    }
    return res.json(response) as unknown as void;
  }
);

router.post(
  '/role/:login',
  AddTeamPermissionsToRequest,
  async (req: ReposAppRequest, res: Response, next: NextFunction) => {
    const { role } = req.body;
    const { login } = req.params;
    if (!login) {
      return next(CreateError.InvalidParameters('invalid login'));
    }
    const permissions = getTeamPermissionsFromRequest(req);
    if (!permissions.allowAdministration) {
      return next(CreateError.NotAuthorized('you do not have permission to administer this team'));
    }
    const team = getContextualTeam(req);
    try {
      const currentRole = await team.getMembership(login, { backgroundRefresh: false, maxAgeSeconds: -1 });
      if (
        !currentRole ||
        (currentRole as ITeamMembershipRoleState).state !== OrganizationMembershipState.Active
      ) {
        return next(CreateError.InvalidParameters(`${login} is not currently a member of the team`));
      }
      const response = await team.addMembership(login, { role });
      return res.json(response) as unknown as void;
    } catch (outcomeError) {
      return next(CreateError.ServerError(outcomeError));
    }
  }
);

router.delete(
  '/role/:login',
  AddTeamPermissionsToRequest,
  async (req: ReposAppRequest, res: Response, next: NextFunction) => {
    const { role } = req.body;
    if (role !== GitHubTeamRole.Member) {
      return next(CreateError.InvalidParameters('invalid role to remove'));
    }
    const { login } = req.params;
    if (!login) {
      return next(CreateError.InvalidParameters('invalid login'));
    }
    const permissions = getTeamPermissionsFromRequest(req);
    if (!permissions.allowAdministration) {
      return next(CreateError.NotAuthorized('you do not have permission to administer this team'));
    }
    const team = getContextualTeam(req);
    try {
      await team.removeMembership(login);
      return res.json({
        ok: true,
      }) as unknown as void;
    } catch (outcomeError) {
      return next(CreateError.ServerError(outcomeError));
    }
  }
);

const deployment = getCompanySpecificDeployment();
if (deployment?.routes?.api?.context?.organization?.team) {
  deployment?.routes?.api?.context?.organization?.team(router);
}

router.use('/*splat', (req, res: Response, next: NextFunction) => {
  return next(jsonError('no API or function available for contextual team', 404));
});

export default router;
