//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { NextFunction, Response } from 'express';

import wrapOrCreateInsightsConsoleClient from '../lib/insights.js';

import debug from 'debug';
const debugStartup = debug('startup');

import appinsights from 'applicationinsights';
import type {
  IReposApplication,
  IProviders,
  ReposAppRequest,
  SiteConfiguration,
  ExecutionEnvironment,
} from '../interfaces/index.js';

function ignoreKubernetesProbes(envelope /* , context */) {
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
  } else if (
    data &&
    data.baseData &&
    data.baseData.name &&
    data.baseData.responseCode &&
    data.baseData.responseCode === '404'
  ) {
    if (data.baseData.name.startsWith('GET /api/')) {
      // Link lookup APIs return 404 by design, which is a success.
      data.baseData.success = true;
    }
  }
  return true;
}

export default function initializeAppInsights(
  providers: IProviders,
  executionEnvironment: ExecutionEnvironment,
  app: IReposApplication,
  config: SiteConfiguration
) {
  let client = undefined;
  if (!config) {
    // Configuration failure happened ahead of this module
    return;
  }
  let cs: string =
    config?.telemetry?.applicationInsightsConnectionString || config?.telemetry?.applicationInsightsKey;
  // Override the key with a job-specific one if this is a job execution instead
  const jobCs: string = config?.telemetry?.jobsApplicationInsightsConnectionString;
  if (jobCs && executionEnvironment.isJob === true) {
    cs = jobCs;
  }
  if (cs) {
    const instance = providers.applicationProfile.logDependencies
      ? appinsights.setup(cs)
      : appinsights.setup(cs).setAutoCollectDependencies(false);
    const defaultClient = appinsights.defaultClient;
    defaultClient.addTelemetryProcessor(ignoreKubernetesProbes);
    defaultClient.addTelemetryProcessor(filterTelemetry);
    instance.start();
    client = defaultClient;
    const configuredInstrumentationKey = client?.config?.instrumentationKey;
    const configuredEndpoint = client?.config?.endpointUrl;
    debugStartup(
      `insights telemetry will use identifier: ${configuredInstrumentationKey.substr(
        0,
        6
      )}* and endpoint ${configuredEndpoint}`
    );
  } else {
    debugStartup('insights telemetry is not configured with a key or connection string');
  }

  app?.use((req: ReposAppRequest, res: Response, next: NextFunction) => {
    // Acknowledge synthetic tests immediately without spending time in more middleware
    if (
      req.headers &&
      req.headers['synthetictest-id'] !== undefined &&
      req.headers['x-ms-user-agent'] !== undefined &&
      req.headers['x-ms-user-agent'].includes('System Center')
    ) {
      return res.status(204).send() as unknown as void;
    }

    // Provide application insight event tracking with correlation ID
    const extraProperties = {
      correlationId: req.correlationId,
    };
    req.insights = wrapOrCreateInsightsConsoleClient(extraProperties, client);
    return next();
  });

  return wrapOrCreateInsightsConsoleClient({}, client);
}
