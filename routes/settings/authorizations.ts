//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

// This feature is internal-only at this time. Assumes AAD-first auth scheme.

import async = require('async');
import express = require('express');
import { ReposAppRequest } from '../../transitional';
import { ICorporateLink } from '../../business/corporateLink';
const router = express.Router();

interface IRequestWithAuthorizations extends ReposAppRequest {
  authorizations?: any;
}

function createGithubTokenValidator(operations, link: ICorporateLink, token) {
  return (callback) => {
    operations.getAuthenticatedAccount(token, (infoError, data) => {
      let valid = true;
      let headers = data && data.extraFields ? data.extraFields.headers : null;
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
        if (data.id != link.thirdPartyId) {
          critical = true;
          valid = false;
          message = `This token is for a different user, "${data.login}", instead of "${link.thirdPartyUsername}".`;
        } else if (data.login != link.thirdPartyUsername) {
          message = `Your username may have changed. It once was "${link.thirdPartyUsername}" but is now "${data.login}". Your ID remains the same.`;
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

router.use((req: IRequestWithAuthorizations, res, next) => {
  // This is a lightweight, temporary implementation of authorization management to help clear
  // stored session tokens for apps like GitHub, VSTS, etc.
  const operations = req.app.settings.providers.operations;
  const link = req.individualContext.link;
  const authorizations = [];
  if (req.individualContext.webContext.tokens.gitHubReadToken) {
    authorizations.push({
      validator: createGithubTokenValidator(operations, link, req.individualContext.webContext.tokens.gitHubReadToken),
      property: 'githubToken',
      title: 'GitHub Application: Public App Token',
      text: 'A GitHub token, authorizing this site, is stored. This token only has rights to read your public profile and validate that you are the authorized user of the GitHub account.',
      mitigations: [
        {
          title: 'Review your GitHub authorized applications',
          url: 'https://github.com/settings/applications',
          mitigation: 'Review your authorized GitHub applications',
        },
      ]
    });
  }
  if (req.individualContext.webContext.tokens.gitHubWriteOrganizationToken) {
    authorizations.push({
      validator: createGithubTokenValidator(operations, link, req.individualContext.webContext.tokens.gitHubWriteOrganizationToken),
      property: 'githubTokenIncreasedScope',
      title: 'GitHub Application: Organization Read/Write Token',
      text: 'A GitHub token, authorizing this site, is stored. The token has a scope to read and write your organization membership. This token is used to automate organization invitation and joining functionality without requiring manual steps.',
      mitigations: [
      ]
    });
  }
  req.authorizations = authorizations;
  next();
});

router.get('/', (req: IRequestWithAuthorizations, res) => {

  const ghi = req.individualContext.getGitHubIdentity();
  let sghi = req.individualContext.getSessionBasedGitHubIdentity();
  if (sghi && ghi && sghi.id === ghi.id) {
    sghi = null;
  }

  req.individualContext.webContext.render({
    view: 'settings/authorizations',
    title: 'Account authorizations',
    state: {
      authorizations: req.authorizations,
      gitHubAccounts: {
        primary: ghi,
        session: sghi,
      },
    },
  });
});

router.get('/validate', (req: IRequestWithAuthorizations, res, next) => {
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
    req.individualContext.webContext.render({
      view: 'settings/authorizations',
      title: 'Account authorizations',
      state: {
        authorizations: req.authorizations,
      },
    });
  });
});

module.exports = router;
