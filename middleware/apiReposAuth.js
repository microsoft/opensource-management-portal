//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

// Auth provider for this application's own local key system.

// As an API authentication provider, the request is augmented with a
// "apiKeyRow" object that provides additional information found
// while validating the key.

const basicAuth = require('basic-auth');
const crypto = require('crypto');

const jsonError = require('./jsonError');

module.exports = function reposAuth (req, res, next) {
  const user = basicAuth(req);
  const key = user? (user.pass || user.name) : null;
  if (!key) {
    return next(jsonError('No key supplied', 400));
  }

  const sha1 = crypto.createHash('sha1');
  sha1.update(key);
  const hashValue = sha1.digest('hex');

  // { owner, description, orgs (comma-sep list) }
  const dc = req.app.settings.dataclient;
  const settingType = 'apiKey';
  const partitionKey = settingType;
  const rowKey = `${settingType}${hashValue}`;
  dc.getSetting(partitionKey, rowKey, (error, setting) => {
    const apiEventProperties = {
      keyHash: hashValue,
      apiVersion: req.apiVersion,
      url: req.originalUrl || req.url,
    };
    const eventName = 'ApiRequest' + (error ? 'Denied' : 'Approved');
    if (error) {
      apiEventProperties.failed = true;
      apiEventProperties.message = error.message;
      apiEventProperties.statusCode = error.statusCode;
    }
    req.insights.trackEvent({ name: eventName, properties: apiEventProperties });
    if (error) {
      req.insights.trackMetric({ name: 'ApiInvalidKey', value: 1 });
      // req.insights.trackException({ exception: error });
      error.skipLog = true;
      return next(jsonError(error.statusCode === 404 ? 'Key not authorized' : error.message, 401));
    }

    if (setting.active === false) {
      error = new Error('A revoked key attempted to use an API');
      error.authErrorMessage = error.message;
      req.insights.trackMetric({ name: 'ApiRevokedKeyAttempt', value: 1 });
      return next(jsonError('Key revoked', 403));
    }

    if (setting.expires) {
      const now = new Date();
      const expires = new Date(setting.expires);
      if (expires < now) {
        error = new Error('A revoked key attempted to use an API');
        error.authErrorMessage = error.message;
        req.insights.trackMetric({ name: 'ApiExpiredKeyAttempt', value: 1 });
        return next(jsonError('Key expired', 403));
      }
    }

    req.insights.trackMetric({ name: 'ApiRequest', value: 1 });
    req.apiKeyRow = setting;
    req.apiKeyRowProvider = 'repos';
    next();
  });
};

