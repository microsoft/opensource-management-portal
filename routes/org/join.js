//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

const express = require('express');
const router = express.Router();
const usernameConsistency = require('../../middleware/links/usernameConsistency');
const utils = require('../../utils');

router.use(function (req, res, next) {
  const organization = req.organization;
  let err = null;
  if (organization.locked) {
    err = new Error('This organization is locked to new members.');
    err.detailed = `At this time, the maintainers of the ${organization.name} organization have decided to not enable onboarding through this portal.`;
    err.skipLog = true;
  }
  next(err);
});

// The join route is an important part of the onboarding experience, so we should
// burn a few additional tokens validating the user's username. This route is
// using the newer operations codepath.
router.use(usernameConsistency(true /* use GitHub API */));

router.get('/', function (req, res, next) {
  const organization = req.organization;
  const context = req.legacyUserContext;
  const username = context.usernames.github;
  const userIncreasedScopeToken = context && context.tokens ? context.tokens.githubIncreasedScope : null;
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
        userDetails.entity = details;
        var title = organization.name + ' Organization Membership ' + (state == 'pending' ? 'Pending' : 'Join');
        req.legacyUserContext.render(req, res, 'org/pending', title, {
          result: result,
          state: state,
          hasIncreasedScope: userIncreasedScopeToken ? true : false,
          organization: organization,
          orgAccount: userDetails,
          onboarding: onboarding,
          writeOrgFailureMessage: writeOrgFailureMessage,
          showTwoFactorWarning: showTwoFactorWarning,
          showApplicationPermissionWarning: showApplicationPermissionWarning,
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
  utils.storeOriginalUrlAsReferrer(req, res, '/auth/github/increased-scope', optionalReason);
}

router.get('/express', function (req, res, next) {
  const organization = req.organization;
  const onboarding = req.query.onboarding;
  const context = req.legacyUserContext;
  const username = context.usernames.github;
  organization.getOperationalMembership(username, function (error, result) {
    var state = result && result.state ? result.state : false;
    if (state == 'active' || state == 'pending') {
      res.redirect(organization.baseUrl + 'join' + (onboarding ? '?onboarding=' + onboarding : '?joining=' + organization.name));
    } else if (context && context.tokens.githubIncreasedScope) {
      joinOrg(req, res, next);
    } else {
      utils.storeOriginalUrlAsReferrer(req, res, '/auth/github/increased-scope', 'need to get increased scope and current org state is ' + state);
    }
  });
});

function joinOrg(req, res, next) {
  const organization = req.organization;
  const onboarding = req.query.onboarding;
  const invitationTeam = organization.invitationTeam;
  const username = req.legacyUserContext.usernames.github;
  invitationTeam.addMembership(username, function (error) {
    if (error) {
      req.insights.trackMetric('GitHubOrgInvitationFailures', 1);
      req.insights.trackEvent('GitHubOrgInvitationFailure', {
        organization: organization.name,
        username: username,
        error: error.message,
      });
      var specificMessage = error.message ? 'Error message: ' + error.message : 'Please try again later. If you continue to receive this message, please reach out for us to investigate.';
      if (error.code === 'ETIMEDOUT') {
        specificMessage = 'The GitHub API timed out.';
      }
      return next(utils.wrapError(error, `We had trouble sending you an invitation through GitHub to join the ${organization.name} organization. ${username} ${specificMessage}`));
    }
    req.insights.trackMetric('GitHubOrgInvitationSuccesses', 1);
    req.insights.trackEvent('GitHubOrgInvitationSuccess', {
      organization: organization.name,
      username: username,
    });
    res.redirect(organization.baseUrl + 'join' + (onboarding ? '?onboarding=' + onboarding : '?joining=' + organization.name));
  });
}

router.post('/', joinOrg);

module.exports = router;
