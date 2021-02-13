//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import express from 'express';
import asyncHandler from 'express-async-handler';
const router = express.Router();

import { ReposAppRequest, IProviders } from '../../transitional';
import { Team } from '../../business/team';
import { IRequestOrganizationPermissions, AddOrganizationPermissionsToRequest } from '../../middleware/github/orgPermissions';
import { OrganizationMembershipState } from '../../business/organization';
import { IAggregateUserSummary } from '../../user/aggregate';
import { TeamJoinApprovalEntity } from '../../entities/teamJoinApproval/teamJoinApproval';

import reposRoute from './repos';

import RouteTeams from './teams';

const membershipRoute = require('./membership');
const joinRoute = require('./join');
const leaveRoute = require('./leave');
const securityCheckRoute = require('./2fa');
const profileReviewRoute = require('./profileReview');
const newRepoSpa = require('./newRepoSpa');
const peopleRoute = require('./people');

interface ILocalOrgRequest extends ReposAppRequest {
  sudoMode?: boolean;
  orgPermissions?: IRequestOrganizationPermissions;
}

router.use(function (req: ReposAppRequest, res, next) {
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
router.get('/', (req: ReposAppRequest, res, next) => {
  if (!req.app.settings.providers || !req.app.settings.providers.campaign) {
    return next();
  }
  return req.app.settings.providers.campaign.redirectGitHubMiddleware(req, res, next, () => {
    return req.organization ? req.organization.name : null;
  });
});

// Routes that do not require that the user be an org member
router.use('/join', joinRoute);
router.use('/repos', reposRoute);
router.use('/people', peopleRoute);
router.use('/teams', RouteTeams);

// Org membership requirement middleware
router.use(asyncHandler(AddOrganizationPermissionsToRequest));

router.use(asyncHandler(async (req: ILocalOrgRequest, res, next) => {
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
}));

// Org membership required endpoints:

router.get('/', asyncHandler(async function (req: ReposAppRequest, res, next) {
  const providers = req.app.settings.providers as IProviders;
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
  results.organizationOverview = await individualContext.aggregations.getAggregatedOrganizationOverview(organization);
  // Check for pending approvals
  const teamsMaintained = results.organizationOverview.teams.maintainer as Team[];
  if (teamsMaintained && teamsMaintained.length && teamsMaintained.length > 0) {
    const teamsMaintainedHash = {};
    for (let i = 0; i < teamsMaintained.length; i++) {
      teamsMaintainedHash[teamsMaintained[i].id] = teamsMaintained[i];
    }
    results.teamsMaintainedHash = teamsMaintainedHash;
    results.pendingApprovals = await approvalProvider.queryPendingApprovalsForTeams(teamsMaintained.map(team => team.id.toString()));
  }
  let organizationEntity = results && results.orgUser ? results.orgUser.getEntity() : null;
  req.individualContext.webContext.render({
    view: 'org/index',
    title: organization.name,
    state: {
      accountInfo: results,
      organization,
      organizationEntity,
    },
  });
}));

router.use('/membership', membershipRoute);
router.use('/leave', leaveRoute);
router.use('/security-check', securityCheckRoute);
router.use('/profile-review', profileReviewRoute);
router.use('/new-repo', (req: ReposAppRequest, res) => {
  const organization = req.organization;
  res.redirect(organization.baseUrl + 'wizard');
});
router.use('/wizard', newRepoSpa);

router.use('/:repoName', asyncHandler(async (req: ReposAppRequest, res, next) => {
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
}));

export default router;
