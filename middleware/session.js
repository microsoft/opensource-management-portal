//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

var session = require('express-session');
var RedisStore = require('connect-redis')(session);

module.exports = function (config) {
    var settings = {
        store: new RedisStore({
            port: config.redis.port,
            host: config.redis.host,
            pass: config.redis.key,
            ttl: config.redis.ttl
        }),
        secret: config.express.sessionSalt,
        name: 'sid',
        resave: false,
        saveUninitialized: false,
        cookie: {
            maxAge: config.redis.ttl * 1000 /* milliseconds for maxAge, not seconds */
        }
    };
    return session(settings);
};
