//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import express = require('express');
import { Application } from 'express';

const app = express();

require('debug')('startup')('loading express application');

import { IProviders } from './transitional';
import initialize from './middleware/initialize';

export interface IReposApplication extends Application {
  // Standard Express
  set(settingName: string, settingValue: any);

   // Local things
   providers: IProviders;

   initializeApplication: (config: any, configurationError: Error, callback) => void;
   initializeJob: (config: any, configurationError: Error, callback) => void;
}

(app as unknown as IReposApplication).initializeApplication = initialize.bind(undefined, app, express, __dirname);

(app as unknown as IReposApplication).initializeJob = function initializeJob(config, configurationError, callback) {
  config.isJobInternal = true;
  config.skipModules = new Set([
    'web',
  ]);
  return initialize(app as unknown as IReposApplication, express, __dirname, config, configurationError, callback);
}

export default app as unknown as IReposApplication;
