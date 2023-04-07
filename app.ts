//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import express from 'express';
import { hostname } from 'os';

import { IReposApplication, IReposJob, IReposJobOptions, IReposJobResult } from './interfaces';

import configResolver from './lib/config';
import initialize from './middleware/initialize';
import { quitInTenSeconds } from './utils';

const app = express() as any as IReposApplication;

import Debug from 'debug';
Debug.debug('startup')('starting...');

app.initializeApplication = initialize.bind(undefined, app, express, __dirname);

app.initializeJob = function initializeJob(config, configurationError) {
  if (config) {
    config.isJobInternal = true;
    config.skipModules = new Set(['web']);
  } else {
    console.warn(`Configuration did not resolve successfully`, configurationError);
  }
  return initialize(app, express, __dirname, config, configurationError);
};

async function startup(startupApplication: boolean) {
  let painlessConfigResolver = null;
  try {
    painlessConfigResolver = configResolver();
  } catch (error) {
    console.warn('Painless config resolver initialization error:');
    console.error(error);
    throw error;
  }
  let config: any = null;
  let configurationError: Error = null;
  try {
    config = await painlessConfigResolver.resolve();
  } catch (error) {
    configurationError = error;
  }

  try {
    if (startupApplication) {
      await app.initializeApplication(config, configurationError);
    } else {
      await app.initializeJob(config, configurationError);
    }
  } catch (startupError) {
    console.error(`Startup error: ${startupError}`);
    process.exit(1); // throw startupError;
  }

  return app;
}

app.startupApplication = startup.bind(null, true);
app.startupJob = startup.bind(null, false);
app.runJob = async function (
  job: (job: IReposJob) => Promise<IReposJobResult | void>,
  options?: IReposJobOptions
): Promise<IReposApplication> {
  options = options || {};
  // TODO: automatically track elapsed job time
  const started = new Date();
  if (options.timeoutMinutes) {
    setTimeout(() => {
      // TODO: insights metric and event, if a prefix exists
      console.log(`Kill bit at ${options.timeoutMinutes}m`);
      process.exit(1);
    }, 1000 * 60 * options.timeoutMinutes);
  }
  if (options.defaultDebugOutput && !process.env.DEBUG) {
    process.env.DEBUG = options.defaultDebugOutput;
  }
  app.isBackgroundJob = true;
  if (options.enableAllGitHubApps) {
    app.enableAllGitHubApps = true;
  }
  try {
    await app.startupJob();
  } catch (startupError) {
    console.error(`Job startup error before runJob: ${startupError}`);
    quitInTenSeconds(false);
    return app;
  }
  if (options.insightsPrefix && app.providers.insights) {
    try {
      app.providers.insights.trackEvent({
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
    app,
    providers: app.providers,
    started,
    parameters: options && options.parameters ? options.parameters : {},
    args: process.argv.length > 2 ? process.argv.slice(2) : [],
  };
  try {
    const result = await job.call(null, jobObject);
    if (result && result.successProperties && app.providers.insights && options.insightsPrefix) {
      try {
        app.providers.insights.trackEvent({
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
    // by default, let's not show the whole inner error
    const simpleError = { ...jobError };
    simpleError?.cause && delete simpleError.cause;
    console.dir(simpleError);
    quitInTenSeconds(false);
    if (options.insightsPrefix && app.providers.insights) {
      try {
        app.providers.insights.trackException({
          exception: jobError,
          properties: {
            name: `${options.insightsPrefix}Failure`,
          },
        });
      } catch (ignoreInsightsError) {
        console.error(`insights error: ${ignoreInsightsError}`);
      }
    }
    return app;
  }
  // CONSIDER: insights metric for job time
  console.log('The job was successful.');
  quitInTenSeconds(true);
  return app;
};

export default app;
