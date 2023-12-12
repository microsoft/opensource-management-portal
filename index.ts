//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import express from 'express';
import Debug from 'debug';

import type { ExecutionEnvironment, IReposApplication, SiteConfiguration } from './interfaces';
import configResolver from './lib/config';
import initialize from './middleware/initialize';

export * from './interfaces';

type InitializeCall = (
  executionEnvironment: ExecutionEnvironment,
  config: SiteConfiguration,
  configurationError: Error
) => Promise<ExecutionEnvironment>;

export function createExpressApplication(): IReposApplication {
  Debug.debug('startup')('starting web framework...');
  const app = express() as any as IReposApplication;

  app.initializeApplication = initializeApp.bind(undefined, app, express, __dirname);
  app.startupApplication = commonStartup.bind(
    undefined,
    app.initializeApplication,
    false /* not a job */,
    true /* enable all apps */,
    app
  );

  return app;
}

function initializeApp(
  app: IReposApplication,
  express: any,
  dirname: string,
  executionEnvironment: ExecutionEnvironment,
  config: SiteConfiguration,
  configurationError: Error
) {
  return initialize(executionEnvironment, app, express, dirname, config, configurationError);
}

export async function commonStartup(
  call: InitializeCall,
  isJob: boolean,
  enableAllGitHubApps: boolean,
  app?: IReposApplication,
  entrypointName?: string
) {
  const executionEnvironment: ExecutionEnvironment = {
    isJob,
    enableAllGitHubApps,
    entrypointName,
    //
    expressApplication: app,
    //
    providers: undefined,
    skipModules: new Set(),
    //
    started: new Date(),
  };

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
  if (isJob) {
    executionEnvironment.skipModules.add('web');
  }
  try {
    await call(executionEnvironment, config, configurationError);
  } catch (startupError) {
    console.error(`Startup error: ${startupError}`);
    if (startupError.stack) {
      console.error(startupError.stack);
    }
    process.exit(1);
  }

  return executionEnvironment;
}
