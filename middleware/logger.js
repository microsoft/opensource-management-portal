//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

const logger = require('morgan');

logger.token('github', function getGitHub(req) {
  return req.user && req.user.github && req.user.github.username ? req.user.github.username : undefined;
});

logger.token('correlationId', function getCorrelationId(req) {
  return req.correlationId ? req.correlationId : undefined;
});

logger.token('scrubbedUrl', function getScrubbedUrl(req) {
  return req.scrubbedUrl || req.originalUrl || req.url;
});

// ----------------------------------------------------------------------------
// Use the customized ogger for Express requests.
// ----------------------------------------------------------------------------
module.exports = logger(':github :method :scrubbedUrl :status :response-time ms - :res[content-length] :correlationId');
