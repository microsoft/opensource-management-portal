//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import debug from 'debug';
import express from 'express';
import fs from 'fs';
import http from 'http';
import https from 'https';
import path from 'path';
import { fileURLToPath } from 'url';

import type { ExecutionEnvironment, IReposApplication, SiteConfiguration } from './interfaces/index.js';

import configResolver from './lib/config/index.js';
import initialize from './middleware/initialize.js';

import { tryInitializeCompanySpecificDeployment } from './middleware/companySpecificDeployment.js';

const debugStartup = debug('startup');
const debugServer = debug('g:server');

export type StartupWebStackOptions = {
  success?: () => Promise<void>;
  skipStartup?: boolean;
};

// We are not currently exporting this module as a library - it's just a site.

// export * from './interfaces';

type InitializeCall = (
  executionEnvironment: ExecutionEnvironment,
  app: IReposApplication,
  config: SiteConfiguration,
  configurationError: Error
) => Promise<ExecutionEnvironment>;

export function startupWebStack(options?: StartupWebStackOptions) {
  // essentially the standard Express ./bin/www
  options = options || {};
  debugStartup('starting web framework...');
  const app = express() as any as IReposApplication;
  const filename = fileURLToPath(import.meta.url);
  const dirname = path.dirname(filename);
  app.initializeApplication = initializeApp.bind(undefined /*, app*/, dirname);
  (app as any).expressInstance = express;
  app.startupApplication = commonStartup.bind(
    undefined,
    app.initializeApplication,
    false /* not a job */,
    true /* enable all apps */,
    app
  );

  function normalizePort(val: string) {
    const port = parseInt(val, 10);
    if (isNaN(port)) {
      return val; // named pipe
    }
    if (port >= 0) {
      return port; // port number
    }
    return false;
  }

  app.startServer = function startWebServer(): Promise<void> {
    const filename = fileURLToPath(import.meta.url);
    const dirname = path.dirname(filename);
    return new Promise((resolve, reject) => {
      try {
        const server: https.Server | http.Server =
          process.env.USE_LOCAL_HTTPS === 'true'
            ? https.createServer(
                {
                  key: fs.readFileSync(path.join(dirname, process.env.CERT_PATH_FROM_DIST_BIN, 'key.pem')),
                  cert: fs.readFileSync(path.join(dirname, process.env.CERT_PATH_FROM_DIST_BIN, 'cert.pem')),
                },
                app
              )
            : http.createServer(app);

        server.on('error', (error) => {
          console.error(`http.server.error: ${error}`);
          if (error['syscall'] !== 'listen') {
            return reject(error);
          }
          const bind = typeof port === 'string' ? 'Pipe ' + port : 'Port ' + port;
          // handle specific listen errors with friendly messages
          switch (error['code']) {
            case 'EACCES':
              console.error(bind + ' requires elevated privileges');
              process.exit(1);
              break;
            case 'EADDRINUSE':
              console.error(bind + ' is already in use');
              process.exit(1);
              break;
            default:
              return reject(error);
          }
        });
        server.on('listening', () => {
          const addr = server.address();
          const bind = typeof addr === 'string' ? 'pipe ' + addr : 'port ' + addr.port;
          debugServer('listening on ' + bind);
          return resolve();
        });
        server.listen(port);
      } catch (error) {
        return reject(error);
      }
    });
  };
  const port = normalizePort(process.env.PORT || '3000');
  app.set('port', port);
  if (options.skipStartup) {
    return app;
  }
  app.startupApplication().then(async function ready() {
    if (options?.success) {
      await options?.success();
    } else {
      debugStartup('web stack is up.');
    }
  });
  return app;
}

function initializeApp(
  dirname: string,
  executionEnvironment: ExecutionEnvironment,
  app: IReposApplication,
  config: SiteConfiguration,
  configurationError: Error
) {
  return initialize(executionEnvironment, app, dirname, config, configurationError);
}

export async function commonStartup(
  call: InitializeCall,
  isJob: boolean,
  enableAllGitHubApps: boolean,
  app?: IReposApplication,
  entrypointName?: string
) {
  await tryInitializeCompanySpecificDeployment();

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
    painlessConfigResolver = await configResolver();
  } catch (error) {
    const extra = error?.path ? ` (${error.path})` : '';
    console.warn(`Painless config resolver initialization error${extra}:`);
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
  if (isJob && !app) {
    executionEnvironment.skipModules.add('web');
  }
  try {
    await call(executionEnvironment, app, config, configurationError);
  } catch (startupError) {
    console.error(`Startup error: ${startupError}`);
    if (startupError.stack) {
      const containsUndefined = startupError.stack.includes('undefined');
      const containsInitialize = startupError.stack.includes('at initialize (');
      if (containsUndefined || !containsInitialize) {
        console.error(startupError.stack);
      }
    }
    process.exit(1);
  }

  return executionEnvironment;
}
