//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

const debug = require('debug')('oss-initialize');
const session = require('express-session');
const RedisStore = require('connect-redis')(session);

module.exports = function (app, config, redisClient) {
  var redisOptions = {
    client: redisClient,
    ttl: config.redis.ttl,
    prefix: config.redis.prefix + '.session:',
  };
  var settings = {
    store: new RedisStore(redisOptions),
    secret: config.session.salt,
    name: config.session.name || 'sid',
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: config.redis.ttl * 1000 /* milliseconds for maxAge, not seconds */
    }
  };
  if (config.webServer.allowHttp === false || config.containers.deployment === true) {
    settings.cookie.secure = true;
  }
  if (config.session.domain) {
    settings.cookie.domain = config.session.domain;
  }
  debug(`session cookie: ${settings.name} ${settings.cookie.secure ? 'SECURE ' : ''} ${settings.cookie.domain ? 'Domain: ' + settings.cookie.domain : ''}`);
  return session(settings);
};
