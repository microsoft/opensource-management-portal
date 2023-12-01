//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { Application } from 'express';
import { IProviders } from './providers';

import type { RuntimeConfiguration } from './config';

export interface IApplicationProfile {
  applicationName: string;
  customErrorHandlerRender?: (errorView: any, err: Error, req: any, res: any, next: any) => Promise<void>;
  customRoutes?: () => Promise<void>;
  logDependencies: boolean;
  serveClientAssets: boolean;
  serveStaticAssets: boolean;
  validate?: () => Promise<void>;
  startup?: (providers: IProviders) => Promise<void>;
  sessions: boolean;
  webServer: boolean;
}

export interface IReposApplication extends Application {
  // Standard Express
  set(settingName: string, settingValue: any);

  // Local things
  providers: IProviders;
  config: any;
  isBackgroundJob: boolean;
  enableAllGitHubApps: boolean;
  runtimeConfiguration: RuntimeConfiguration;

  startServer: () => Promise<void>;

  initializeApplication: (config: any, configurationError: Error) => Promise<IReposApplication>;
  initializeJob: (config: any, configurationError: Error) => Promise<IReposApplication>;
  startupApplication: () => Promise<IReposApplication>;
  startupJob: () => Promise<IReposApplication>;
  runJob: (
    job: (job: IReposJob) => Promise<IReposJobResult | void>,
    options?: IReposJobOptions
  ) => Promise<IReposApplication>;
}

export interface IReposJob {
  app: IReposApplication;
  started: Date;
  providers: IProviders;
  parameters: any;
  args: string[];
}

export interface IReposJobResult {
  successProperties?: any;
}

export interface IReposJobOptions {
  timeoutMinutes?: number;
  defaultDebugOutput?: string;
  insightsPrefix?: string;
  parameters?: any;
  enableAllGitHubApps?: boolean;
}
