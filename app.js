//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

const async = require('async');
const DataClient = require('./data');
const express = require('express');
const redis = require('redis');
const app = express();

// Asynchronous initialization for the Express app, configuration and data stores.
app.initializeApplication = function init(config, configurationError, callback) {
  var dc;
  var finalizeInitialization = (error) => {
    if (dc) {
      app.set('dataclient', dc);
      dc.cleanupInTheFuture = {
        redisClient: redisClient
      };
    }
    app.set('runtimeConfig', config);
    require('./middleware/')(app, express, config, __dirname, redisClient, error);
    if (!error) {
      app.use('/', require('./routes/'));
    }
    require('./middleware/error-routes')(app, error);
    callback(null, app);
  };
  if (configurationError) {
    return finalizeInitialization(configurationError);
  }

  var redisFirstCallback;
    var redisOptions = {
        auth_pass: config.redis.key,
    };
    if (config.redis.tls) {
        redisOptions.tls = {
            servername: config.redis.tls,
        };
    }
    var redisClient = redis.createClient(config.redis.port, config.redis.host, redisOptions);
    redisClient.on('connect', function () {
        if (redisFirstCallback) {
            var cb = redisFirstCallback;
            redisFirstCallback = null;
            cb();
        }
    });
    async.parallel([
        function (cb) {
            new DataClient(config, function (error, dcInstance) {
                dc = dcInstance;
                cb(error);
            });
        },
        function (cb) {
            redisFirstCallback = cb;
            redisClient.auth(config.redis.key);
        },
    ], function (error) {
        finalizeInitialization(error);
    });
};

module.exports = app;
