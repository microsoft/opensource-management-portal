//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { CreateError } from '../../lib/transitional.js';
import type { IProviders } from '../../interfaces/providers.js';

import { initializeCosmosRestCache } from './cosmos.js';
import { initializeRedisRestCache } from './redis.js';
import { initializeBlobRestCache } from './blob.js';
import getCompanySpecificDeployment from '../companySpecificDeployment.js';

export async function initializeRestCache(providers: IProviders) {
  const { config } = providers;
  const cacheConfig = config.github.cache;
  const cacheProvider = cacheConfig.provider;

  const companySpecific = getCompanySpecificDeployment();
  if (companySpecific?.features?.restCache) {
    const cacheProvider = await companySpecific.features.restCache.tryCreateInstance(providers, config);
    if (cacheProvider) {
      providers.cacheProvider = cacheProvider;
      return;
    }
  }
  switch (cacheProvider) {
    case 'cosmosdb': {
      await initializeCosmosRestCache(providers);
      return;
    }
    case 'redis': {
      await initializeRedisRestCache(providers);
      return;
    }
    case 'blob': {
      await initializeBlobRestCache(providers);
      return;
    }
    default: {
      throw CreateError.InvalidParameters('No cache provider available: ' + cacheProvider);
    }
  }
}
