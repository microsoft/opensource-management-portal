//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

const insights = require('../lib/insights');

const appInsights = require('applicationinsights');

function ignoreKubernetesProbes(envelope/* , context */) {
  if ('RequestData' === envelope.data.baseType) {
    const data = envelope.data;
    if (data.baseData.name.startsWith && data.baseData.name.startsWith('GET /health/')) {
      // Do not log any telemetry for k8s and health probes
      return false;
    }
  }
  return true;
}

function filterTelemetry(envelope, context): boolean {
  const { data } = envelope;
  if (data && data.baseType === 'RequestData' && data.baseData.responseCode === '401') {
    // We believe 401 is successful, not a failure
    data.baseData.success = true;
  }
  return true;
}

module.exports = function initializeAppInsights(app, config) {
  let client = undefined;
  if (!config) {
    // Configuration failure happened ahead of this module
    return;
  }
  let key = config.telemetry && config.telemetry.applicationInsightsKey ? config.telemetry.applicationInsightsKey : null;
  // Override the key with a job-specific one if this is a job execution instead
  if (config.telemetry && config.telemetry.jobsApplicationInsightsKey && config.isJobInternal === true) {
    key = config.telemetry.jobsApplicationInsightsKey;
  }
  if (key) {
    const instance = appInsights.setup(key).setAutoCollectDependencies(false);
    client = appInsights.defaultClient;
    client.addTelemetryProcessor(ignoreKubernetesProbes);
    client.addTelemetryProcessor(filterTelemetry);
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
