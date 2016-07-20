//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

const logger = require('morgan');

logger.token('id', function getUserId(req) {
  let config = req.app.settings.runtimeConfig;
  if (config) {
    let userType = config.primaryAuthenticationScheme === 'aad' ? 'azure' : 'github';
    return req.user && req.user[userType] && req.user[userType].username ? req.user[userType].username : undefined;
  }
});

logger.token('correlationId', function getCorrelationId(req) {
  return req.correlationId;
});

logger.token('scrubbedUrl', function getScrubbedUrl(req) {
  return req.scrubbedUrl || req.originalUrl || req.url;
});

// ----------------------------------------------------------------------------
// Use the customized logger for Express requests.
// ----------------------------------------------------------------------------
module.exports = logger(':id :method :scrubbedUrl :status :response-time ms - :res[content-length] :correlationId');
