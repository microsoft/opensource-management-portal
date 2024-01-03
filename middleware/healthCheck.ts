//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import Debug from 'debug';
import { IncomingHttpHeaders } from 'http';
import { NextFunction, Response } from 'express';

import type {
  ConfiguredHeaderProbe,
  ConfiguredGeneralProbe,
  ConfiguredProbeBase,
} from '../config/webHealthProbes.types';
import { IReposApplication, ReposAppRequest, SiteConfiguration } from '../interfaces';
import { CreateError } from '../lib/transitional';

const dbg = Debug.debug('health');

const supportedHeaderProbeTypes = ['kubernetes', 'azurefrontdoor'];
const supportedGeneralProbeTypes = ['external', 'azureappservice-windows', 'azureappservice-linux'];

enum HealthProbeType {
  Readiness = 'ready',
  Liveness = 'healthy',
}

enum ProbeType {
  General = 'general',
  Header = 'header',
}

export default function initializeHealthCheck(
  app: IReposApplication,
  config: SiteConfiguration /* WebHealthProbeSubsetConfiguration */
) {
  const { webHealthProbes: healthConfig } = config;

  const enabledHeaderProbes =
    healthConfig?.enabled === true
      ? supportedHeaderProbeTypes
          .map((typeName) => {
            const probeConfig = healthConfig[typeName] as ConfiguredHeaderProbe;
            return probeConfig?.allowed === true ? probeConfig : null;
          })
          .filter((configured) => configured)
      : [];
  const enabledGenericProbes =
    healthConfig?.enabled === true
      ? supportedGeneralProbeTypes
          .map((typeName) => {
            const probeConfig = healthConfig[typeName] as ConfiguredGeneralProbe;
            return probeConfig?.allowed && (probeConfig.endpointSuffix || probeConfig.endpoint)
              ? probeConfig
              : null;
          })
          .filter((configured) => configured)
      : [];

  const configuredHealthDelays = {
    [HealthProbeType.Readiness]: healthConfig?.delay?.readiness || 0,
    [HealthProbeType.Liveness]: healthConfig?.delay?.liveness || 0,
  };

  function checkHealth(checkType: HealthProbeType) {
    const started = app.settings.started;
    const startupSeconds = configuredHealthDelays[checkType];
    if (configuredHealthDelays[checkType] === undefined || configuredHealthDelays[checkType] === null) {
      throw new Error('Invalid health check type');
    }
    const now = new Date();
    const startupMs = startupSeconds * 1000;
    if (now.getTime() - started.getTime() <= startupMs) {
      // Still in the startup period
      dbg(`Returning ${checkType} OK: within the startup delay window`);
      return true;
    }
    const isHealthy = !!provider[checkType as string];
    const asString = isHealthy ? 'OK' : 'FALSE';
    dbg(`Returning ${checkType} ${asString}`);
    return isHealthy;
  }

  function multipleHeaderHealthCheck(
    checkType: HealthProbeType,
    probeType: ProbeType,
    probeConfigs: ConfiguredHeaderProbe[],
    req: ReposAppRequest,
    res: Response,
    next: NextFunction
  ) {
    for (const probeConfig of probeConfigs) {
      if (requestEligibleForCheck(checkType, probeType, probeConfig, req.headers)) {
        return returnExpressHealthCheck(checkType, req, res, next);
      }
    }
    return next();
  }

  function requestEligibleForCheck(
    checkType: HealthProbeType,
    probeType: ProbeType,
    probeConfig: ConfiguredProbeBase,
    headers: IncomingHttpHeaders
  ) {
    switch (probeType) {
      case ProbeType.General: {
        return true;
      }
      case ProbeType.Header: {
        const specificConfig = probeConfig as ConfiguredHeaderProbe;
        const { expectedHeader } = specificConfig;
        if (!headers[expectedHeader.name]) {
          dbg(
            `Health probe for ${checkType} skipped: ${expectedHeader.name} header was not present in the HTTP request`
          );
          return false;
        }
        if (headers[expectedHeader.name] !== expectedHeader.value) {
          dbg(
            `Health probe for ${checkType} skipped: requested with the ${
              expectedHeader.name
            } header. The value "${headers[expectedHeader.name]}" didn't match the expected value of "${
              expectedHeader.value
            }"`
          );
          return false;
        }
        break;
      }
      default: {
        throw CreateError.InvalidParameters(`Invalid health probe type ${probeType}`);
      }
    }
    return true;
  }

  function returnExpressHealthCheck(
    checkType: HealthProbeType,
    req: ReposAppRequest,
    res: Response,
    next: NextFunction
  ) {
    let result = null;
    try {
      result = checkHealth(checkType);
    } catch (error) {
      error.statusCode = 500;
      return next(error);
    }
    res.status(result ? 200 : 500).end();
  }

  const provider = {
    ready: false,
    healthy: true,
  };

  if (enabledHeaderProbes.length > 0 && app) {
    dbg(`Configured header health probes: ${enabledHeaderProbes.length}`);
    app.get(
      '/health/readiness',
      multipleHeaderHealthCheck.bind(null, HealthProbeType.Readiness, ProbeType.Header, enabledHeaderProbes)
    );
    app.get(
      '/health/liveness',
      multipleHeaderHealthCheck.bind(null, HealthProbeType.Liveness, ProbeType.Header, enabledHeaderProbes)
    );
  }
  if (enabledGenericProbes.length > 0 && app) {
    // General probes listen on their own type endpoint
    for (const genericProbeConfig of enabledGenericProbes) {
      const url = genericProbeConfig.endpoint || `/health/${genericProbeConfig.endpointSuffix}`;
      dbg(`Configured general health probe: ${url}`);
      app.get(
        url,
        multipleHeaderHealthCheck.bind(null, HealthProbeType.Liveness, ProbeType.General, [
          genericProbeConfig,
        ])
      );
    }
  }
  if (app && enabledGenericProbes.length + enabledGenericProbes.length > 0) {
    dbg('Health probes listening');
    // 404 on anything that was not handled by any active, allowed probe listeners
    app.use('/health/*', (req, res) => {
      return res.status(404).end();
    });
  } else {
    dbg('No health probes listening');
  }

  return provider;
}
