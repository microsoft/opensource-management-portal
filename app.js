//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

const express = require('express');
const app = express();

require('debug')('oss-initialize')('loading express application');

const initialize = require('./middleware/initialize');

app.initializeApplication = initialize.bind(undefined, app, express, __dirname);

module.exports = app;
