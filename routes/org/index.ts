//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

import express from 'express';
import asyncHandler from 'express-async-handler';
const router = express.Router();

import async from 'async';

import { ReposAppRequest, IProviders } from '../../transitional';
import { Team } from '../../business/team';
import { IRequestOrganizationPermissions, AddOrganizationPermissionsToRequest } from '../../middleware/github/orgPermissions';
import { OrganizationMembershipState } from '../../business/organization';

const teamsRoute = require('./teams');
const reposRoute = require('./repos');
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
router.use('/teams', teamsRoute);

// Org membership requirement middleware
router.use(asyncHandler(AddOrganizationPermissionsToRequest), asyncHandler(async (req: ILocalOrgRequest, res, next) => {
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

router.get('/', function (req: ReposAppRequest, res, next) {
  const providers = req.app.settings.providers as IProviders;
  const operations = providers.operations;
  const approvalProvider = providers.approvalProvider;
  const organization = req.organization;
  const username = req.individualContext.getGitHubIdentity().username;
  const id = req.individualContext.getGitHubIdentity().id;
  async.parallel({
    organizationOverview: (callback) => {
      const uc = operations.getUserContext(id);
      return uc.getAggregatedOrganizationOverview(organization.name).then(ok => {
        return callback(null, ok);
      }).catch(error => {
        return callback(error);
      });
    },
    isMembershipPublic: function (callback) {
      organization.checkPublicMembership(username).then(membershipResult => {
        return callback(null, membershipResult);
      }).catch(error => {
        return callback(error);
      });
    },
    orgUser: function (callback) {
      organization.getDetails().then(details => {
        if (details) {
          return callback(null, organization.memberFromEntity(details));
        } else {
          return callback();
        }
      }).catch(error => {
        return callback(error);
      });
    },
    /*
    CONSIDER: UPDATE ORG SUDOERS SYSTEM UI...
    isAdministrator: function (callback) {
        legacyUserContext.isAdministrator(callback);
    }*/
  },
    function (error, results: any) {
      if (error) {
        return next(error);
      }
      if (results.isAdministrator && results.isAdministrator === true) {
        results.isSudoer = true;
      }
      const render = function (results) {
        req.individualContext.webContext.render({
          view: 'org/index',
          title: organization.name,
          state: {
            accountInfo: results,
            organization: organization,
            overwriteRemainingPrivateRepos: organization.overwriteRemainingPrivateRepos,
          },
        });
      };
      // Check for pending approvals
      const teamsMaintained = results.organizationOverview.teams.maintainer as Team[];
      if (teamsMaintained && teamsMaintained.length && teamsMaintained.length > 0) {
        const teamsMaintainedHash = {};
        for (let i = 0; i < teamsMaintained.length; i++) {
          teamsMaintainedHash[teamsMaintained[i].id] = teamsMaintained[i];
        }
        results.teamsMaintainedHash = teamsMaintainedHash;
        approvalProvider.queryPendingApprovalsForTeams(teamsMaintained.map(team => team.id)).then(pendingApprovals => {
          results.pendingApprovals = pendingApprovals;
          return render(results);
        }).catch(errorIgnored => {
          return render(results);
        });
      } else {
        render(results);
      }
    });
});

router.use('/membership', membershipRoute);
router.use('/leave', leaveRoute);
router.use('/security-check', securityCheckRoute);
router.use('/profile-review', profileReviewRoute);
router.use('/new-repo', (req: ReposAppRequest, res) => {
  const organization = req.organization;
  res.redirect(organization.baseUrl + 'wizard');
});
router.use('/wizard', newRepoSpa);

module.exports = router;
