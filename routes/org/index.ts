//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { NextFunction, Response, Router } from 'express';
const router: Router = Router();

import { getProviders } from '../../lib/transitional.js';
import { IAggregateUserSummary } from '../../business/user/aggregate.js';
import { TeamJoinApprovalEntity } from '../../business/entities/teamJoinApproval/teamJoinApproval.js';
import { Team } from '../../business/index.js';
import { ReposAppRequest, OrganizationMembershipState } from '../../interfaces/index.js';
import {
  IRequestOrganizationPermissions,
  AddOrganizationPermissionsToRequest,
} from '../../middleware/github/orgPermissions.js';

import RouteRepos from './repos.js';
import RouteTeams from './teams.js';
import RouteMembership from './membership.js';
import RouteJoin from './join.js';
import RouteLeave from './leave.js';
import RouteSecurityCheck from './2fa.js';
import RouteProfileReview from './profileReview.js';
import RouteNewRepoSpa from './newRepoSpa.js';
import RoutePeople from './people.js';

interface ILocalOrgRequest extends ReposAppRequest {
  sudoMode?: boolean;
  orgPermissions?: IRequestOrganizationPermissions;
}

router.use(function (req: ReposAppRequest, res: Response, next: NextFunction) {
  const onboarding = req.query.onboarding;
  const organization = req.organization;
  req.individualContext.webContext.pushBreadcrumb(organization.name, onboarding ? false : undefined);
  req.reposContext = {
    section: 'org',
    organization: req.organization,
  };
  next();
});

// Campaign-related redirect to take the user to GitHub
router.get('/', (req: ReposAppRequest, res: Response, next: NextFunction) => {
  const providers = getProviders(req);
  if (!providers || !providers.campaign) {
    return next();
  }
  return providers.campaign.redirectGitHubMiddleware(req, res, next, () => {
    return req.organization ? req.organization.name : null;
  });
});

// Routes that do not require that the user be an org member
router.use('/join', RouteJoin);
router.use('/repos', RouteRepos);
router.use('/people', RoutePeople);
router.use('/teams', RouteTeams);

// Org membership requirement middleware
router.use(AddOrganizationPermissionsToRequest);

router.use(async (req: ILocalOrgRequest, res: Response, next: NextFunction) => {
  const organization = req.organization;
  const orgPermissions = req.orgPermissions;
  if (!orgPermissions) {
    return next(new Error('Organization permissions are unavailable'));
  }
  // Decorate the route for the sudoer
  if (orgPermissions.sudo) {
    req.sudoMode = true;
  }
  const membershipStatus = orgPermissions.membershipStatus;
  if (membershipStatus === OrganizationMembershipState.Active) {
    return next();
  } else {
    const individualContext = req.individualContext;
    const username = individualContext.getGitHubIdentity().username;

    await organization.getOperationalMembership(username);
    return res.redirect('/' + organization.name + '/join');
  }
});

// Org membership required endpoints:

router.get('/', async function (req: ReposAppRequest, res: Response, next: NextFunction) {
  const providers = getProviders(req);
  const approvalProvider = providers.approvalProvider;
  const organization = req.organization;
  const username = req.individualContext.getGitHubIdentity().username;
  const individualContext = req.individualContext;
  const results = {
    orgUser: organization.memberFromEntity(await organization.getDetails()),
    isMembershipPublic: await organization.checkPublicMembership(username),
    organizationOverview: null as IAggregateUserSummary,
    isAdministrator: false, // CONSIDER: UPDATE ORG SUDOERS SYSTEM UI... ... legacyUserContext.isAdministrator(callback);
    isSudoer: false, // if (results.isAdministrator && results.isAdministrator === true) { results.isSudoer = true;
    teamsMaintainedHash: null,
    pendingApprovals: null as TeamJoinApprovalEntity[],
  };
  results.organizationOverview =
    await individualContext.aggregations.getAggregatedOrganizationOverview(organization);
  // Check for pending approvals
  const teamsMaintained = results.organizationOverview.teams.maintainer as Team[];
  if (teamsMaintained && teamsMaintained.length && teamsMaintained.length > 0) {
    const teamsMaintainedHash = {};
    for (let i = 0; i < teamsMaintained.length; i++) {
      teamsMaintainedHash[teamsMaintained[i].id] = teamsMaintained[i];
    }
    results.teamsMaintainedHash = teamsMaintainedHash;
    results.pendingApprovals = await approvalProvider.queryPendingApprovalsForTeams(
      teamsMaintained.map((team) => team.id.toString())
    );
  }
  const organizationEntity = results && results.orgUser ? results.orgUser.getEntity() : null;
  req.individualContext.webContext.render({
    view: 'org/index',
    title: organization.name,
    state: {
      accountInfo: results,
      organization,
      organizationEntity,
    },
  });
});

router.use('/membership', RouteMembership);
router.use('/leave', RouteLeave);
router.use('/security-check', RouteSecurityCheck);
router.use('/profile-review', RouteProfileReview);
router.use('/new-repo', (req: ReposAppRequest, res) => {
  const organization = req.organization;
  res.redirect(organization.baseUrl + 'wizard');
});
router.use('/wizard', RouteNewRepoSpa);

router.use('/:repoName', async (req: ReposAppRequest, res: Response, next: NextFunction) => {
  const repoName = req.params.repoName;
  const organization = req.organization;
  const attemptedRepository = organization.repository(repoName);
  try {
    const details = await attemptedRepository.getDetails();
    const correctUrl = `${organization.baseUrl}repos/${details.name}`;
    return res.redirect(correctUrl);
  } catch (error) {
    return next();
  }
});

export default router;
