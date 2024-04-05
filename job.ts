//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { hostname } from 'os';
import Debug from 'debug';

import type {
  ExecutionEnvironment,
  IProviders,
  IReposJob,
  IReposJobOptions,
  IReposJobResult,
  SiteConfiguration,
} from './interfaces';
import { commonStartup } from '.';
import { quitInTenSeconds } from './lib/utils';
import initialize from './middleware/initialize';

export async function runJob(
  job: (job: IReposJob) => Promise<IReposJobResult | void>,
  options?: IReposJobOptions
): Promise<IReposJobResult | void> {
  Debug.debug('startup')('starting job...');

  options = options || {};
  // TODO: automatically track elapsed job time
  const started = new Date();
  if (options.timeoutMinutes) {
    setTimeout(
      () => {
        // TODO: insights metric and event, if a prefix exists
        console.log(`Kill bit at ${options.timeoutMinutes}m`);
        process.exit(1);
      },
      1000 * 60 * options.timeoutMinutes
    );
  }
  if (options.defaultDebugOutput && !process.env.DEBUG) {
    process.env.DEBUG = options.defaultDebugOutput;
  }

  let executionEnvironment: ExecutionEnvironment = null;
  try {
    executionEnvironment = await commonStartup(
      initializeJob,
      true /* job */,
      options.enableAllGitHubApps,
      null /* app */,
      options.name
    );
  } catch (startupError) {
    console.error(`Job startup error before runJob: ${startupError}`);
    quitInTenSeconds(false);
    return;
  }
  const providers = executionEnvironment?.providers;
  if (options.insightsPrefix && providers?.insights) {
    try {
      providers?.insights?.trackEvent({
        name: `${options.insightsPrefix}Started`,
        properties: {
          hostname: hostname(),
        },
      });
    } catch (ignoreInsightsError) {
      console.error(`insights error: ${ignoreInsightsError}`);
    }
  }
  const jobObject = {
    app: providers?.app,
    executionEnvironment,
    providers,
    started,
    parameters: options && options.parameters ? options.parameters : {},
    args: process.argv.length > 2 ? process.argv.slice(2) : [],
  };
  let result: IReposJobResult = null;
  try {
    result = (await job.call(null, jobObject)) as IReposJobResult;
    if (result?.successProperties && providers?.insights && options.insightsPrefix) {
      try {
        providers?.insights?.trackEvent({
          name: `${options.insightsPrefix}Success`,
          properties: Object.assign(
            {
              hostname: hostname(),
            },
            result.successProperties
          ),
        });
      } catch (ignoreInsightsError) {
        console.error(`insights error: ${ignoreInsightsError}`);
      }
    }
  } catch (jobError) {
    console.error(`The job failed: ${jobError}`);
    if (jobError.stack) {
      console.error(jobError.stack);
    }
    // by default, let's not show the whole inner error
    const simpleError = { ...jobError };
    simpleError?.cause && delete simpleError.cause;
    console.dir(simpleError);
    const config = providers?.config;
    quitInTenSeconds(false, config);
    if (options.insightsPrefix) {
      try {
        providers?.insights?.trackException({
          exception: jobError,
          properties: {
            name: `${options.insightsPrefix}Failure`,
          },
        });
      } catch (ignoreInsightsError) {
        console.error(`insights error: ${ignoreInsightsError}`);
      }
    }
    trySilentInsightsFlush(providers);
    return result;
  }
  // CONSIDER: insights metric for job time
  trySilentInsightsFlush(providers);
  console.log();
  console.log('The job was successful.');
  quitInTenSeconds(true);
  return result;
}

function trySilentInsightsFlush(providers: IProviders) {
  try {
    providers?.insights?.flush();
  } catch (ignored) {
    console.warn(ignored);
  }
}

function initializeJob(
  executionEnvironment: ExecutionEnvironment,
  config: SiteConfiguration,
  configurationError: Error
) {
  if (!config || configurationError) {
    console.warn(`Configuration did not resolve successfully`, configurationError);
  }
  return initialize(
    executionEnvironment,
    null /* app */,
    null /* express */,
    __dirname,
    config,
    configurationError
  );
}

export const job = {
  runBackgroundJob: async (
    script: (providers: IProviders, jobParameters?: IReposJob) => Promise<IReposJobResult | void>,
    options?: IReposJobOptions
  ) => {
    return runJob(
      async function (jobParameters: IReposJob) {
        return (await script(jobParameters.providers, jobParameters)) || {};
      },
      Object.assign({ enableAllGitHubApps: false }, options || {})
    );
  },
  run: async (
    script: (providers: IProviders, jobParameters?: IReposJob) => Promise<IReposJobResult | void>,
    options?: IReposJobOptions
  ) => {
    return runJob(
      async function (jobParameters: IReposJob) {
        return (await script(jobParameters.providers, jobParameters)) || {};
      },
      Object.assign({ enableAllGitHubApps: true }, options || {})
    );
  },
};

export default job;
