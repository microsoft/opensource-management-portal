//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import type { IProviders } from '../../interfaces/providers.js';
import { connectRedis } from '../redis.js';

export async function prepareRedisSessions(providers: IProviders) {
  const { config } = providers;

  const redisSessionClient = await connectRedis(config, config.session.redis, 'session');

  providers.sessionRedisClient = redisSessionClient;
}
