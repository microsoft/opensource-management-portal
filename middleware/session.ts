//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import debug = require('debug');
const dbg = debug('oss-initialize');

const session = require('express-session');
const RedisStore = require('connect-redis')(session);

const saltNotSet = 'session-salt-not-set-warning';

const supportedProviders = [
  'memory',
  'redis',
];

module.exports = function (app, config, redisClient) {
  const sessionProvider = config.session.provider;
  if (!supportedProviders.includes(sessionProvider)) {
    throw new Error(`The configured session provider ${sessionProvider} is not supported`);
  }

  const isProduction = config.node.environment === 'production';
  const sessionSalt = config.session.salt;
  if (isProduction && sessionSalt === saltNotSet) {
    throw new Error('In a production Node.js environment, a SESSION_SALT must be set');
  }
  if (isProduction && sessionProvider === 'memory') {
    throw new Error('In a production Node.js environment, a SESSION_PROVIDER of type \'memory\' is not supported.');
  }

  let store = undefined;
  if (sessionProvider === 'redis') {
    const redisPrefix = config.redis.prefix ? `${config.redis.prefix}.session` : 'session';
    const redisOptions = {
      client: redisClient,
      ttl: config.redis.ttl,
      prefix: redisPrefix,
    };
    store = new RedisStore(redisOptions);
  }

  const settings = {
    secret: sessionSalt,
    name: config.session.name || 'sid',
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: config.redis.ttl * 1000 /* milliseconds for maxAge, not seconds */,
      secure: undefined,
      domain: undefined,
    }
  };
  if (config.webServer.allowHttp === false || config.containers.deployment === true) {
    settings.cookie.secure = true;
  }
  if (config.session.domain) {
    settings.cookie.domain = config.session.domain;
  }
  if (store) {
    settings['store'] = store;
  }
  dbg(`session cookie: ${settings.name} ${settings.cookie.secure ? 'SECURE ' : ''} ${settings.cookie.domain ? 'Domain: ' + settings.cookie.domain : ''} via ${sessionProvider}`);
  return session(settings);
};
