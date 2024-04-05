//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { Application, Response, NextFunction } from 'express';

import type { IProviders } from './providers';
import type { RuntimeConfiguration, SiteConfiguration } from './config';
import type { ReposAppRequest } from './web';

export type ApplicationProfile = {
  applicationName: string;
  customErrorHandlerRender?: (
    errorView: unknown,
    err: Error,
    req: ReposAppRequest,
    res: Response,
    next: NextFunction
  ) => Promise<void | unknown>;
  customRoutes?: () => Promise<void>;
  logDependencies: boolean;
  serveClientAssets: boolean;
  serveStaticAssets: boolean;
  validate?: () => Promise<void>;
  startup?: (providers: IProviders) => Promise<void>;
  sessions: boolean;
  webServer: boolean;
};

export interface IReposApplication extends Application {
  // Standard Express
  set(settingName: string, settingValue: any);

  // Local things
  providers: IProviders;
  config: SiteConfiguration;
  isBackgroundJob: boolean;
  enableAllGitHubApps: boolean;
  runtimeConfiguration: RuntimeConfiguration;

  executionEnvironment: ExecutionEnvironment;

  startServer: () => Promise<void>;

  initializeApplication: (
    executionEnvironment: ExecutionEnvironment,
    config: SiteConfiguration,
    configurationError: Error
  ) => Promise<IReposApplication>;

  startupApplication: () => Promise<IReposApplication>;
  runJob: (
    job: (job: IReposJob) => Promise<IReposJobResult | void>,
    options?: IReposJobOptions
  ) => Promise<IReposJobResult | void>;
}

export type ExecutionEnvironment = {
  isJob: boolean;
  enableAllGitHubApps: boolean;

  expressApplication: IReposApplication | null;

  providers: IProviders;
  skipModules: Set<string>;

  entrypointName: string;

  started: Date;
};

export interface IReposJob {
  app: IReposApplication;
  started: Date;
  providers: IProviders;
  parameters: any;
  args: string[];

  executionEnvironment: ExecutionEnvironment;
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
  name?: string;
}
