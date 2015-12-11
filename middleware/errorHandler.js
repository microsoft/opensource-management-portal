//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

var uuid = require('node-uuid');

module.exports = function(err, req, res, next) {
    var config = null;
    var errorStatus = err && err.status ? err.status : undefined;
    if (req && req.app && req.app.settings && req.app.settings.dataclient && req.app.settings.runtimeConfig) {
        config = req.app.settings.runtimeConfig;
        var version = config && config.logging && config.logging.version ? config.logging.version: '?';
        var dc = req.app.settings.dataclient;
        if (config.logging.errors && err.status !== 403 && err.skipLog !== true) {
            dc.insertErrorLogEntry(version, req, err);
        }
    }
    if (err !== undefined && err.skipLog !== true) {
        console.log('Error: ' + (err && err.message ? err.message : 'Error is undefined.'));
        if (err.stack) {
            console.error(err.stack);
        }
        if (err.innerError) {
            var inner = err.innerError;
            console.log('Inner: ' + inner.message);
            if (inner.stack) {
                console.log(inner.stack);
            }
        }
    }
    // Bubble OAuth errors to the forefront... this is the rate limit scenario.
    if (err && err.oauthError && err.oauthError.statusCode && err.oauthError.statusCode && err.oauthError.data) {
        var detailed = err.message;
        err = err.oauthError;
        err.status = err.statusCode;
        var data = JSON.parse(err.data);
        if (data && data.message) {
            err.message = err.statusCode + ': ' + data.message;
        } else {
            err.message = err.statusCode + ' Unauthorized received. You may have exceeded your GitHub API rate limit or have an invalid auth token at this time.';
        }
        err.detailed = detailed;
    }
    // Don't leak the Redis connection information.
    if (err && err.message && err.message.indexOf('Redis connection') >= 0 && err.message.indexOf('ETIMEDOUT')) {
        err.message = 'The session store was temporarily unavailable. Please try again.';
        err.detailed = 'Azure Redis Cache';
    }
    if (res.headersSent) {
        console.error('Headers were already sent.');
        return next(err);
    }
    res.status(err.status || 500);
    res.render('error', {
        message: err.message,
        serviceBanner: config && config.serviceBanner ? config.serviceBanner : undefined,
        detailed: err && err.detailed ? err.detailed : undefined,
        errorFancyLink: err && err.fancyLink ? err.fancyLink : undefined,
        errorStatus: errorStatus,
        skipLog: err.skipLog,
        error: {},
        title: err.status === 404 ? 'Not Found' : 'Oops',
        user: req.user,
        config: config,
    });
};
