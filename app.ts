//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import express = require('express');
const app = express();

require('debug')('oss-initialize')('loading express application');

const initialize = require('./middleware/initialize');

app['initializeApplication'] = initialize.bind(undefined, app, express, __dirname);

app['initializeJob'] = function initializeJob(config, configurationError, callback) {
  config.isJobInternal = true;
  return initialize(app, express, __dirname, config, configurationError, callback);
}

module.exports = app;
