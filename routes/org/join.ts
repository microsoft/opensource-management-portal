//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

import express = require('express');
import { ReposAppRequest } from '../../transitional';
import { Team } from '../../business/team';
import { IndividualContext } from '../../business/context2';
import { storeOriginalUrlAsReferrer, wrapError } from '../../utils';
import { Organization } from '../../business/organization';
const router = express.Router();

router.use(function (req: ReposAppRequest, res, next) {
  const organization = req.organization;
  let err = null;
  if (organization.locked) {
    err = new Error('This organization is locked to new members.');
    err.detailed = `At this time, the maintainers of the ${organization.name} organization have decided to not enable onboarding through this portal.`;
    err.skipLog = true;
  }
  next(err);
});

router.get('/', function (req: ReposAppRequest, res, next) {
  const organization = req.organization;
  const username = req.individualContext.getGitHubIdentity().username;
  const userIncreasedScopeToken = req.individualContext.webContext.tokens.gitHubWriteOrganizationToken;
  let onboarding = req.query.onboarding;
  let showTwoFactorWarning = false;
  let showApplicationPermissionWarning = false;
  let writeOrgFailureMessage = null;
  organization.getOperationalMembership(username, (error, result) => {
    let state = result && result.state ? result.state : false;
    const clearAuditListAndRedirect = function () {
      // Behavior change, only important to those not using GitHub's 2FA enforcement feature; no longer clearing the cache
      const url = organization.baseUrl + 'security-check' + (onboarding ? '?onboarding=' + onboarding : '?joining=' + organization.name);
      res.redirect(url);
    };
    const showPage = function () {
      organization.getDetails(function (error, details) {
        if (error) {
          return next(error);
        }
        const userDetails = details ? organization.memberFromEntity(details) : null;
        userDetails['entity'] /* adding to the object */ = details;
        var title = organization.name + ' Organization Membership ' + (state == 'pending' ? 'Pending' : 'Join');
        req.individualContext.webContext.render({
          view: 'org/pending',
          title,
          state: {
            result: result,
            state: state,
            hasIncreasedScope: userIncreasedScopeToken ? true : false,
            organization: organization,
            orgAccount: userDetails,
            onboarding: onboarding,
            writeOrgFailureMessage: writeOrgFailureMessage,
            showTwoFactorWarning: showTwoFactorWarning,
            showApplicationPermissionWarning: showApplicationPermissionWarning,
          },
        });
      });
    };
    if (state === 'active') {
      clearAuditListAndRedirect();
    } else if (state === 'pending' && userIncreasedScopeToken) {
      organization.acceptOrganizationInvitation(userIncreasedScopeToken, function (error, updatedState) {
        if (error) {
          // We do not error out, they can still fall back on the
          // manual acceptance system that the page will render.
          writeOrgFailureMessage = error.message || 'The GitHub API did not allow us to join the organization for you. Follow the instructions to continue.';
          if (error.statusCode == 401) { // These comparisons should be == and not ===
            return redirectToIncreaseScopeExperience(req, res, 'GitHub API status code was 401');
          } else if (error.statusCode == 403 && writeOrgFailureMessage.includes('two-factor')) {
            showTwoFactorWarning = true;
          } else if (error.statusCode == 403) {
            showApplicationPermissionWarning = true;
          }
        }
        if (!error && updatedState && updatedState.state === 'active') {
          return clearAuditListAndRedirect();
        }
        showPage();
      });
    } else {
      showPage();
    }
  });
});

function redirectToIncreaseScopeExperience(req, res, optionalReason) {
  storeOriginalUrlAsReferrer(req, res, '/auth/github/increased-scope', optionalReason);
}

router.get('/express', function (req: ReposAppRequest, res, next) {
  const organization = req.organization;
  const onboarding = req.query.onboarding;
  const username = req.individualContext.getGitHubIdentity().username;
  organization.getOperationalMembership(username, function (error, result) {
    var state = result && result.state ? result.state : false;
    if (state == 'active' || state == 'pending') {
      res.redirect(organization.baseUrl + 'join' + (onboarding ? '?onboarding=' + onboarding : '?joining=' + organization.name));
    } else if (req.individualContext.webContext.tokens.gitHubWriteOrganizationToken) {
      joinOrg(req, res, next);
    } else {
      storeOriginalUrlAsReferrer(req, res, '/auth/github/increased-scope', 'need to get increased scope and current org state is ' + state);
    }
  });
});

function joinOrg(req, res, next) {
  const individualContext = req.individualContext as IndividualContext;
  const organization = req.organization;
  const onboarding = req.query.onboarding;
  joinOrganization(individualContext, organization, req.insights, onboarding).then(val => {
    res.redirect(organization.baseUrl + 'join' + (onboarding ? '?onboarding=' + onboarding : '?joining=' + organization.name));

  }).catch(next);
}

async function joinOrganization(individualContext: IndividualContext, organization: Organization, insights, isOnboarding: boolean): Promise<any> {
  const invitationTeam = organization.invitationTeam as Team;
  const username = individualContext.getGitHubIdentity().username;
  if (!username) {
    throw new Error('A GitHub username was not found in the user\'s link.');
  }
  let joinResult = null;
  try {
    joinResult = invitationTeam ? await invitationTeam.addMembershipAsync(username, null) : await organization.addMembershipAsync(username, null);
  } catch (error) {
    insights.trackMetric({ name: 'GitHubOrgInvitationFailures', value: 1 });
    insights.trackEvent({
      name: 'GitHubOrgInvitationFailure',
      properties: {
        organization: organization.name,
        username: username,
        error: error.message,
      },
    });
    var specificMessage = error.message ? 'Error message: ' + error.message : 'Please try again later. If you continue to receive this message, please reach out for us to investigate.';
    if (error.code === 'ETIMEDOUT') {
      specificMessage = 'The GitHub API timed out.';
    }
    throw wrapError(error, `We had trouble sending you an invitation through GitHub to join the ${organization.name} organization. ${username} ${specificMessage}`);
  }

  insights.trackMetric({ name: 'GitHubOrgInvitationSuccesses', value: 1 });
  insights.trackEvent({
    name: 'GitHubOrgInvitationSuccess',
    properties: {
      organization: organization.name,
      username: username,
    },
  });

  return joinResult;
}

router.post('/', joinOrg);

module.exports = router;
