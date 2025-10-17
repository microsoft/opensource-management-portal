//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { ManagedIdentityCredential, TokenCredential } from '@azure/identity';

import {
  getEntraApplicationUserAssignedIdentityCredential,
  tryGetEntraApplicationTokenCredential,
} from '../../lib/applicationIdentity.js';
import CosmosCache from '../../lib/caching/cosmosdb.js';

import type { IProviders } from '../../interfaces/providers.js';

export async function initializeCosmosRestCache(providers: IProviders) {
  const { config } = providers;
  const { useManagedIdentity } = config.github.cache.cosmosdb;

  let tokenCredential: ManagedIdentityCredential;
  let blobTokenCredential: TokenCredential;
  if (useManagedIdentity) {
    tokenCredential = getEntraApplicationUserAssignedIdentityCredential(config, true);
  } else {
    // When not using Managed Identity with Cosmos, the blob connection will
    // use Entra client authentication _instead_ of the user-assigned identity. This
    // is likely only used in development scenarios.
    blobTokenCredential = tryGetEntraApplicationTokenCredential(providers, 'caching');
  }

  const cosmosCache = new CosmosCache({
    ...config.github.cache.cosmosdb,
    tokenCredential,
    blobTokenCredential,
  });
  await cosmosCache.initialize();

  providers.cacheProvider = cosmosCache;
}
