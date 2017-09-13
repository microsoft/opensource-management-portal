//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

const wrapError = require('../../utils').wrapError;

module.exports = function (validateGitHubAccount) {
  // This middleware is designed to keep a link up-to-date with
  // available GitHub information.
  //
  // The lightweight version (validateGitHubAccount is falsey) will
  // just use any information in the session for the user; this is
  // if they have recently authenticated with that service.
  //
  // The heavier version will actually make a request for the user's
  // GitHub user ID, and look for any key updates to fields from there.
  // Due to the latency this should only be used on pages performing
  // data changes on behalf of the GitHub user.

  function lightweightSessionConsistency(req, res, next) {
    const legacyUserContext = req.legacyUserContext;
    if (!legacyUserContext || !legacyUserContext.modernUser() || legacyUserContext.modernUser().link === false) {
      return next();
    }
    const link = req.legacyUserContext.modernUser().link;
    if (req.user.azure && req.user.azure.oid && link.aadoid && req.user.azure.oid !== link.aadoid) {
      return next(new Error('Directory security identifier mismatch. Please submit a report to have this checked on.'));
    }
    if (req.user.github && req.user.github.id && link.ghid && req.user.github.id !== link.ghid) {
      let securityError = new Error('GitHub user security identifier mismatch. Did you delete your GitHub account and recreate an identically named one? Please submit a report to have this checked on for security purposes. Operations: if this is a valid request, delete remnents of the previous user account.');
      const multipleAccountsEnabled = req.session.selectedGithubId && req.session.enableMultipleAccounts === true;
      if (multipleAccountsEnabled) {
        securityError = wrapError(null, 'You are currently signed in to an account on GitHub.com that is different than the one you have selected for your session. Please sign out of GitHub and head back.', true);
        securityError.fancyLink = {
          title: 'Sign out of GitHub',
          link: '/signout/github?redirect=github',
        };
      }
      try {
        legacyUserContext.invalidateLinkCache(req.legacyUserContext.id.aad, () => {}); // Try to invalidate any cached links to help with ops scenarios
      } catch (ignoreError) {
        // This does not impact providing the user with an error message
      }
      return next(securityError);
    }
    const linkUpdates = {};
    const updatedProperties = new Set();
    const sessionToLinkMap = {
      github: {
        username: 'ghu',
        avatarUrl: 'ghavatar',
        accessToken: 'githubToken',
      },
      githubIncreasedScope: {
        accessToken: 'githubTokenIncreasedScope',
      },
      azure: {
        displayName: 'aadname',
        username: 'aadupn',
      },
    };
    for (let sessionKey in sessionToLinkMap) {
      for (let property in sessionToLinkMap[sessionKey]) {
        const linkProperty = sessionToLinkMap[sessionKey][property];
        if (req.user[sessionKey] && req.user[sessionKey][property] && link[linkProperty] !== req.user[sessionKey][property]) {
          linkUpdates[linkProperty] = req.user[sessionKey][property];
          updatedProperties.add(`${sessionKey}.${property}`);
        }
      }
    }
    if (updatedProperties.has('github.accessToken')) {
      linkUpdates.githubTokenUpdated = new Date().getTime();
    }
    if (updatedProperties.has('githubIncreasedScope.accessToken')) {
      linkUpdates.githubTokenIncreasedScopeUpdated = new Date().getTime();
    }
    if (Object.keys(linkUpdates).length === 0) {
      return next();
    }
    Object.assign(link, linkUpdates);
    const dataClient = req.app.settings.providers.dataClient;
    const id = req.legacyUserContext.id.github;
    dataClient.updateLink(id, link, (mergeError) => {
      if (mergeError) {
        req.insights.trackMetric('LinkConsistencyFailures', 1);
        req.insights.trackEvent('LinkConsistencyFailure', {
          updates: JSON.stringify(linkUpdates),
          error: mergeError.message,
        });
        return next(mergeError);
      }
      req.insights.trackMetric('LinkConsistencySuccesses', 1);
      req.insights.trackEvent('LinkConsistencySuccess', {
        updates: JSON.stringify(linkUpdates),
      });
      req.legacyUserContext.setPropertiesFromLink(link, () => {
        req.legacyUserContext.invalidateLinkCache(link.aadoid, next);
      });
    });
  }

  function heavyConsistency(req, res, next) {
    'use strict';
    const context = req.legacyUserContext;
    if (!context || !context.id.github) {
      return next(new Error('A middleware component expected a user context ahead of validating the GitHub account.'));
    }

    const operations = req.app.settings.operations;
    const account = operations.getAccount(context.id.github);
    account.getDetails((error) => {
      if (error) {
        return next(wrapError(error, 'Your GitHub account details could not be retrieved at this time through the GitHub API.'));
      }
      if (account.login === context.usernames.github) {
        return next();
      }
      const oldLogin = context.usernames.github;
      const user = context.modernUser();
      const link = user.link;
      link.ghu = account.login;
      if (account.avatar_url && account.avatar_url !== link.ghavatar) {
        link.ghavatar = account.avatar_url;
      }

      account.updateLink(link, (error) => {
        if (error) {
          req.insights.trackMetric('GitHubUserConsistencyFailures', 1);
          req.insights.trackEvent('GitHubUserConsistencyFailure', {
            oldLogin: oldLogin,
            oid: link.aadoid,
            login: account.login,
            error: error.message,
          });
          return next(wrapError(error, 'It looks like your GitHub username has changed, but we were not able to update our records. Please try again soon or report this error.'));
        }
        req.insights.trackMetric('GitHubUserConsistencySuccesses', 1);
        req.insights.trackEvent('GitHubUserConsistencySuccess', {
          oldLogin: oldLogin,
          oid: link.aadoid,
          login: account.login,
        });
        context.usernames.github = account.login;
        if (req.user.github) {
          req.user.github.username = account.login;
        }
        // Need to re-save the entire user
        req.login(req.user, () => {
          return next();
        });
      });
    });
  }

  return validateGitHubAccount ? heavyConsistency : lightweightSessionConsistency;
};
