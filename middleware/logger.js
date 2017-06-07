//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

const logger = require('morgan');

const encryptionMetadataKey = '_ClientEncryptionMetadata2';
const piiFormat = ':id :method :scrubbedUrl :status :response-time ms - :res[content-length] :encryptedSession :correlationId';
const format = ':method :scrubbedUrl :status :response-time ms - :res[content-length] :encryptedSession :correlationId';

logger.token('encryptedSession', function getUserId(req) {
  const config = req.app.settings.runtimeConfig;
  if (req.session && req.session.passport && req.session.passport.user) {
    const userType = config.authentication.scheme === 'aad' ? 'azure' : 'github';
    return req.session.passport.user[userType] && req.session.passport.user[userType][encryptionMetadataKey] !== undefined ? 'encrypted' : 'plain';
  }
});

logger.token('id', function getUserId(req) {
  const config = req.app.settings.runtimeConfig;
  if (config) {
    const userType = config.authentication.scheme === 'aad' ? 'azure' : 'github';
    return req.user && req.user[userType] && req.user[userType].username ? req.user[userType].username : undefined;
  }
});

logger.token('correlationId', function getCorrelationId(req) {
  return req.correlationId;
});

logger.token('scrubbedUrl', function getScrubbedUrl(req) {
  return req.scrubbedUrl || req.originalUrl || req.url;
});

module.exports = function createLogger(config) {
  return logger(config && config.debug && config.debug.showUsers === true ? piiFormat : format);
};
