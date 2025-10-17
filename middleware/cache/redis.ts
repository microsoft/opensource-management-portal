//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { connectRedis } from '../redis.js';
import RedisHelper from '../../lib/caching/redis.js';

import type { IProviders } from '../../interfaces/providers.js';

export async function initializeRedisRestCache(providers: IProviders) {
  const { config } = providers;

  const redisClient = await connectRedis(config, config.redis, 'cache');

  const redisHelper = new RedisHelper({ redisClient, prefix: config.redis.prefix });
  providers.cacheProvider = redisHelper;
}
