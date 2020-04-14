//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import express = require('express');
const app = express();

require('debug')('startup')('loading express application');

import initialize from './middleware/initialize';
import { IReposApplication } from './transitional';

app['initializeApplication'] = initialize.bind(undefined, app, express, __dirname);

app['initializeJob'] = function initializeJob(config, configurationError, callback) {
  config.isJobInternal = true;
  return initialize(app as unknown as IReposApplication, express, __dirname, config, configurationError, callback);
}

module.exports = app;
