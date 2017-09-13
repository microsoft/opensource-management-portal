//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

const insights = require('../lib/insights');

module.exports = function initializeAppInsights(app, config) {
  let client = undefined;
  if (!config) {
    // Configuration failure happened ahead of this module
    return;
  }
  const key = config.telemetry && config.telemetry.applicationInsightsKey ? config.telemetry.applicationInsightsKey : null;
  if (key) {
    const appInsights = require('applicationinsights');
    const instance = appInsights.setup(key).setAutoCollectDependencies(false);
    client = instance && instance.getClient ? instance.getClient(key) : appInsights.defaultClient;
    instance.start();
  }

  app.use((req, res, next) => {
    // Acknowledge synthetic tests immediately without spending time in more middleware
    if (req.headers && req.headers['synthetictest-id'] !== undefined && req.headers['x-ms-user-agent'] !== undefined && req.headers['x-ms-user-agent'].includes('System Center')) {
      return res.status(204).send();
    }

    // Provide application insight event tracking with correlation ID
    const extraProperties = {
      correlationId: req.correlationId,
    };
    req.insights = insights(extraProperties, client);
    next();
  });

  return insights({}, client);
};
