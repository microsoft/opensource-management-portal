//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

var async = require('async');
var DataClient = require('./data');
var express = require('express');
var redis = require('redis');
var app = express();

// Asynchronous initialization for the Express app, configuration and data stores.
app.initializeApplication = function init(config, callback) {
    var dc;
    var redisFirstCallback;
    var redisClient = redis.createClient(config.redis.port, config.redis.host);
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
                cb();
            });
        },
        function (cb) {
            redisFirstCallback = cb;
            redisClient.auth(config.redis.key);
        },
    ], function (error) {
        if (error) {
            throw error;
        }
        app.set('dataclient', dc);
        dc.cleanupInTheFuture = {
            redisClient: redisClient
        };
        app.set('runtimeConfig', config);
        require('./middleware/')(app, express, config, __dirname);
        app.use('/', require('./routes/'));
        require('./middleware/error-routes')(app);
        callback(null, app);
    });
};

module.exports = app;
