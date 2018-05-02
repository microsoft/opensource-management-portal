//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

const jsonError = require('./jsonError');

// We have made a decision to not use Passport for the API routes, which is why this
// performs some passport-like functionality...

// We treat the presence of "apiKeyRow" on the request as indicating a
// successful authentication for our API systems.

module.exports = function returnCombinedMiddleware(supportedProviders) {
  if (!supportedProviders) {
    throw new Error('No supportedProviders provided');
  }
  if (!Array.isArray(supportedProviders)) {
    throw new Error('supportedProviders must be an array');
  }
  let totalProviders = supportedProviders.length;
  if (totalProviders <= 0) {
    throw new Error('supportedProviders must provide at least one provider to use for auth');
  }
  return function middleware(req, res, next) {
    let i = 0;

    let currentProvider = supportedProviders[i];
    let authErrorMessages = [];
    function wrappedNext(error) {
      if (!error) {
        // No error but also now API use information
        if (!req.apiKeyRow) {
          error = jsonError('No apiKeyRow was set by the authentication provider', 500);
          return next(error);
        }

        // Auth succeeded
        return next();
      }

      if (error.authErrorMessage) {
        authErrorMessages.push(error.authErrorMessage);
      }

      ++i;
      if (i >= totalProviders) {
        authErrorMessages.push('Authentication failed, no providers were able to authorize you');
        error = jsonError(authErrorMessages.join('. '), 401);
      } else {
        // Ignore the error and continue
        currentProvider = supportedProviders[i];
        return currentProvider(req, res, wrappedNext);
      }

      if (!error) {
        error = jsonError('Major auth problem', 500);
      }

      return next(error);
    }
    return currentProvider(req, res, wrappedNext);
  };
};
