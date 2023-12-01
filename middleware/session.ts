//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import Debug from 'debug';
import session from 'express-session';
import connectRedis from 'connect-redis';

import type { IProviders, IReposApplication, SiteConfiguration } from '../interfaces';

const dbg = Debug.debug('startup');

const saltNotSet = 'session-salt-not-set-warning';

const supportedProviders = ['memory', 'redis', 'cosmosdb'];

export default async function ConnectSession(
  app: IReposApplication,
  config: SiteConfiguration,
  providers: IProviders
) {
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
    throw new Error(
      "In a production Node.js environment, a SESSION_PROVIDER of type 'memory' is not supported."
    );
  }
  let store = undefined;
  if (sessionProvider === 'redis') {
    if (!providers.sessionRedisClient) {
      throw new Error('No provided session Redis client');
    }
    const { sessionRedisClient } = providers;
    if (!config?.session?.redis?.ttl) {
      throw new Error('config.session.redis.ttl is required');
    }
    const redisPrefix = config.session.redis.prefix ? `${config.session.redis.prefix}.session` : 'session';
    const redisLegacy = sessionRedisClient.duplicate();
    redisLegacy.connect();

    // NIH - Replaced this as redis auth does not work with upstream
    // auth logic here.
    await redisLegacy.auth({ password: config.session.redis.key });
    const redisOptions = {
      client: redisLegacy,
      ttl: config.session.redis.ttl,
      prefix: redisPrefix,
    };
    store = new connectRedis(redisOptions);
  } else if (sessionProvider === 'cosmosdb') {
    if (!providers.session) {
      throw new Error('No provided session store');
    }
    store = providers.session;
  }
  const ttlFromStore = store && store['ttl'] ? store['ttl'] : null;
  const settings = {
    secret: sessionSalt,
    name: config.session.name || 'sid',
    resave: false,
    saveUninitialized: false,
    cookie: {
      // TODO: 2020: consider SameSite setting requirements here that are compatible with the IdP
      maxAge: (ttlFromStore || 86400) * 1000 /* milliseconds for maxAge, not seconds */,
      secure: undefined,
      domain: undefined,
    },
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
  dbg(
    `session cookie: ${settings.name} ${settings.cookie.secure ? 'SECURE ' : ''} ${
      settings.cookie.domain ? 'Domain: ' + settings.cookie.domain : ''
    } via ${sessionProvider}`
  );
  return session(settings);
}
