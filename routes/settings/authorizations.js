//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

// This feature is internal-only at this time. Assumes AAD-first auth scheme.

const async = require('async');
const express = require('express');
const router = express.Router();

function createGithubTokenValidator(operations, link, token) {
  return (callback) => {
    operations.getAuthenticatedAccount(token, (infoError, data) => {
      let valid = true;
      let headers = data && data.extraFields ? data.extraFields.meta : null;
      let critical = false;
      let message = null;
      if (infoError) {
        valid = false;
        if (infoError.statusCode === 401 && infoError.message === 'Bad credentials') {
          message = 'GitHub token revoked or expired';
          critical = true;
        } else {
          message = infoError.message;
        }
      } else {
        // NOTE: We use strings while GitHub does not
        if (data.id != link.ghid) {
          critical = true;
          valid = false;
          message = `This token is for a different user, "${data.login}", instead of "${link.ghu}".`;
        } else if (data.login != link.ghu) {
          message = `Your username may have changed. It once was "${link.ghu}" but is now "${data.login}". Your ID remains the same.`;
        }
      }
      const result = {
        valid: valid,
        message: message,
        critical: critical,
        rateLimitRemaining: headers && headers['x-ratelimit-remaining'] ? headers['x-ratelimit-remaining'] + ' remaining API tokens' : undefined,
      };
      callback(null, result);
    });
  };
}

router.use((req, res, next) => {
  // This is a lightweight, temporary implementation of authorization management to help clear
  // stored session tokens for apps like GitHub, VSTS, etc.
  const link = req.link;
  const operations = req.app.settings.providers.operations;
  const authorizations = [];
  if (link.githubToken) {
    authorizations.push({
      validator: createGithubTokenValidator(operations, link, link.githubToken),
      property: 'githubToken',
      title: 'GitHub Application: Public App Token',
      text: 'A GitHub token, authorizing this site, is stored. This token only has rights to read your public profile and validate that you are the authorized user of the GitHub account.',
      mitigations: [
        {
          title: 'Clear GitHub tokens',
          url: '/settings/authorizations/github/clear',
          mitigation: 'Clear GitHub tokens',
        },
        {
          title: 'Review your GitHub authorized applications',
          url: 'https://github.com/settings/applications',
          mitigation: 'Review your authorized GitHub applications',
        },
      ]
    });
  }
  if (link.githubTokenIncreasedScope) {
    authorizations.push({
      validator: createGithubTokenValidator(operations, link, link.githubTokenIncreasedScope),
      property: 'githubTokenIncreasedScope',
      title: 'GitHub Application: Organization Read/Write Token',
      text: 'A GitHub token, authorizing this site, is stored. The token has a scope to read and write your organization membership. This token is used to automate organization invitation and joining functionality without requiring manual steps.',
      mitigations: [
        {
          title: 'Clear GitHub tokens',
          url: '/settings/authorizations/github/clear',
          mitigation: 'Clear GitHub tokens',
        },
      ]
    });
  }
  req.authorizations = authorizations;
  next();
});

router.get('/', (req, res) => {
  req.legacyUserContext.render(req, res, 'settings/authorizations', 'Account authorizations', {
    authorizations: req.authorizations,
  });
});

router.get('/github/clear', (req, res, next) => {
  const dc = req.app.settings.providers.dataClient;
  const link = req.link;
  const linkAuthorizationsToDrop = ['githubToken', 'githubTokenIncreasedScope', 'githubTokenUpdated', 'githubTokenIncreasedScopeUpdated'];
  linkAuthorizationsToDrop.forEach((property) => {
    delete link[property];
  });
  const id = req.legacyUserContext.id.github;
  const aadoid = link.aadoid;
  dc.updateLink(id, link, error => {
    if (error) {
      return next(error);
    }
    req.legacyUserContext.saveUserAlert(req, 'The GitHub tokens stored for this account have been removed. You may be required to authorize access to your GitHub account again to continue using this portal.', 'GitHub tokens cleared', 'success');
    req.legacyUserContext.invalidateLinkCache(aadoid, () => {
      return res.redirect('/signout/github/');
    });
  });
});

router.get('/validate', (req, res, next) => {
  async.each(req.authorizations, (authorization, callback) => {
    const validator = authorization.validator;
    if (validator !== undefined && typeof validator === 'function') {
      validator((actualError, validationResult) => {
        if (actualError) {
          return callback(actualError);
        }
        authorization.valid = validationResult;
        if (validationResult.critical === true) {
          // TODO: Actually delete this token/authorization
        }
        callback();
      });
    } else {
      callback();
    }
  }, (error) => {
    if (error) {
      return next(error);
    }
    req.legacyUserContext.render(req, res, 'settings/authorizations', 'Account authorizations', {
      authorizations: req.authorizations,
    });
  });
});

module.exports = router;
