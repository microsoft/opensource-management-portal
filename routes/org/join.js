//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

const express = require('express');
const router = express.Router();
const usernameConsistency = require('../../middleware/links/usernameConsistency');
const utils = require('../../utils');

router.use(function (req, res, next) {
  var org = req.org;
  var err = null;
  if (org.setting('locked')) {
    err = new Error('This organization is locked to new members.');
    err.detailed = 'At this time, the maintainers of the "' + org.name + '" organization have decided to not enable onboarding through this portal.';
    err.skipLog = true;
  }
  next(err);
});

// The join route is an important part of the onboarding experience, so we should
// burn a few additional tokens validating the user's username. This route is
// using the newer operations codepath.
router.use(usernameConsistency(true /* use GitHub API */));

router.get('/', function (req, res, next) {
  const org = req.org;
  const context = req.oss;
  const userIncreasedScopeToken = context && context.tokens ? context.tokens.githubIncreasedScope : null;
  var onboarding = req.query.onboarding;
  var showTwoFactorWarning = false;
  var showApplicationPermissionWarning = false;
  var writeOrgFailureMessage = null;
  org.queryUserMembership(false /* do not allow caching */, function (error, result) {
    var state = result && result.state ? result.state : false;
    var clearAuditListAndRedirect = function () {
      org.clearAuditList(function () {
        var url = org.baseUrl + 'security-check' + (onboarding ? '?onboarding=' + onboarding : '?joining=' + org.name);
        res.redirect(url);
      });
    };
    var showPage = function () {
      org.getDetails(function (error, details) {
        if (error) {
          return next(error);
        }
        var userDetails = details ? org.oss.user(details.id, details) : null;
        var title = org.name + ' Organization Membership ' + (state == 'pending' ? 'Pending' : 'Join');
        req.oss.render(req, res, 'org/pending', title, {
          result: result,
          state: state,
          hasIncreasedScope: userIncreasedScopeToken ? true : false,
          org: org,
          orgUser: userDetails,
          onboarding: onboarding,
          writeOrgFailureMessage: writeOrgFailureMessage,
          showTwoFactorWarning: showTwoFactorWarning,
          showApplicationPermissionWarning: showApplicationPermissionWarning,
        });
      });
    };
    if (state == 'active') {
      clearAuditListAndRedirect();
    } else if (state == 'pending' && userIncreasedScopeToken) {
      org.acceptOrganizationInvitation(userIncreasedScopeToken, function (error, updatedState) {
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
  var org = req.org;
  var onboarding = req.query.onboarding;
  const context = req.oss;
  org.queryUserMembership(false /* do not allow caching */, function (error, result) {
    var state = result && result.state ? result.state : false;
    if (state == 'active' || state == 'pending') {
      res.redirect(org.baseUrl + 'join' + (onboarding ? '?onboarding=' + onboarding : '?joining=' + org.name));
    } else if (context && context.tokens.githubIncreasedScope) {
      joinOrg(req, res, next);
    } else {
      utils.storeOriginalUrlAsReferrer(req, res, '/auth/github/increased-scope', 'need to get increased scope and current org state is ' + state);
    }
  });
});

function joinOrg(req, res, next) {
  var org = req.org;
  var onboarding = req.query.onboarding;
  var everyoneTeam = org.getAllMembersTeam();
  var username = req.oss.usernames.github;
  everyoneTeam.addMembership('member', function (error) {
    if (error) {
      req.insights.trackMetric('GitHubOrgInvitationFailures', 1);
      req.insights.trackEvent('GitHubOrgInvitationFailure', {
        org: org.name,
        username: username,
        error: error.message,
      });
      var specificMessage = error.message ? 'Error message: ' + error.message : 'Please try again later. If you continue to receive this message, please reach out for us to investigate.';
      if (error.code === 'ETIMEDOUT') {
        specificMessage = 'The GitHub API timed out.';
      }
      return next(utils.wrapError(error, `We had trouble sending you an invitation through GitHub to join the ${org.name} organization. ${username} ${specificMessage}`));
    }
    req.insights.trackMetric('GitHubOrgInvitationSuccesses', 1);
    req.insights.trackEvent('GitHubOrgInvitationSuccess', {
      org: org.name,
      username: username,
    });
    res.redirect(org.baseUrl + 'join' + (onboarding ? '?onboarding=' + onboarding : '?joining=' + org.name));
  });
}

router.post('/', joinOrg);

module.exports = router;
