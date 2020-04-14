//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

// Auth provider for this application's own local key system.

// As an API authentication provider, the request is augmented with a
// "apiKeyRow" object that provides additional information found
// while validating the key.

const basicAuth = require('basic-auth');
import crypto from 'crypto';

import { jsonError } from './jsonError';
import { IProviders, ReposAppRequest } from '../transitional';
import { PersonalAccessToken } from '../entities/token/token';

export interface IApiRequest extends ReposAppRequest {
  apiKeyToken: PersonalAccessToken;
  apiKeyProviderName: string;
  apiVersion?: string;

  userContextOverwriteRequest?: any; // refactor?
}

export function ReposApiAuthentication(req: IApiRequest, res, next) {
  const user = basicAuth(req);
  const key = user? (user.pass || user.name) : null;
  if (!key) {
    return next(jsonError('No key supplied', 400));
  }

  const sha1 = crypto.createHash('sha1');
  sha1.update(key);
  const hashValue = sha1.digest('hex');

  const providers = req.app.settings.providers as IProviders;
  const tokenProvider = providers.tokenProvider;

  const apiEventProperties = {
    keyHash: hashValue,
    apiVersion: req.apiVersion,
    url: req.originalUrl || req.url,
    failed: undefined,
    message: undefined,
    statusCode: undefined,
  };
  tokenProvider.getToken(hashValue).then((token: PersonalAccessToken) => {
    return after(null, token);
  }).catch(error => {
    return after(error, null);
  });

  function after(tokenError: any, token: PersonalAccessToken) {
    const eventName = 'ApiRequest' + (tokenError ? 'Denied' : 'Approved');
    if (tokenError) {
      apiEventProperties.failed = true;
      apiEventProperties.message = tokenError.message;
      apiEventProperties.statusCode = tokenError.statusCode;
    }
    req.insights.trackEvent({ name: eventName, properties: apiEventProperties });
    if (tokenError) {
      req.insights.trackMetric({ name: 'ApiInvalidKey', value: 1 });
      tokenError.skipLog = true;
      return next(jsonError(tokenError.statusCode === 404 ? 'Key not authorized' : tokenError.message, 401));
    }
    if (token.isRevoked()) {
      tokenError = new Error('A revoked key attempted to use an API');
      tokenError.authErrorMessage = tokenError.message;
      req.insights.trackMetric({ name: 'ApiRevokedKeyAttempt', value: 1 });
      return next(jsonError('Key revoked', 403));
    }
    if (token.isExpired()) {
      tokenError = new Error('A revoked key attempted to use an API');
      tokenError.authErrorMessage = tokenError.message;
      req.insights.trackMetric({ name: 'ApiExpiredKeyAttempt', value: 1 });
      return next(jsonError('Key expired', 403));
    }
    req.insights.trackMetric({ name: 'ApiRequest', value: 1 });
    req.apiKeyToken = token;
    req.apiKeyProviderName = 'repos';
    return next();
  }
}
