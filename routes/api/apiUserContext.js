//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

const jsonError = require('./jsonError');
const OpenSourceUserContext = require('../../lib/context');

module.exports = function prepareUserContext(req, res, next) {
  const options = {
    config: req.app.settings.runtimeConfig,
    dataClient: req.app.settings.dataclient,
    redisClient: req.app.settings.dataclient.cleanupInTheFuture.redisClient,
    redisHelper: req.app.settings.redisHelper,
    githubLibrary: req.app.settings.githubLibrary,
    ossDbClient: req.app.settings.ossDbConnection,
    operations: req.app.settings.providers.operations,
    request: req,
    insights: req.insights,
  };
  new OpenSourceUserContext(options, (error, instance) => {
    req.legacyUserContext = instance;
    if (error && (error.tooManyLinks === true || error.anotherAccount === true)) {
      return next(jsonError(error, 400));
    }
    return next();
  });
};
