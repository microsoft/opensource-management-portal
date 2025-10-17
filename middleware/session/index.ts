//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { CreateError } from '../../lib/transitional.js';
import type { IProviders } from '../../interfaces/providers.js';

import { prepareCosmosSessionMiddleware } from './cosmos.js';
import { prepareRedisSessions } from './redis.js';
import { prepareFileSessions } from './file.js';

export async function prepareSessionMiddleware(providers: IProviders) {
  const { config } = providers;

  switch (config.session.provider) {
    case 'cosmosdb':
      await prepareCosmosSessionMiddleware(providers);
      break;
    case 'redis':
      await prepareRedisSessions(providers);
      break;
    case 'file': {
      await prepareFileSessions(providers);
      break;
    }
    case 'memory':
      // no-op
      break;
    default:
      throw CreateError.NotImplemented(`session provider not implemented ${config.session.provider}`);
  }
}
