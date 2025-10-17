//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { tryGetEntraApplicationTokenCredential } from '../../lib/applicationIdentity.js';
import BlobCache from '../../lib/caching/blob.js';

import type { IProviders } from '../../interfaces/providers.js';

export async function initializeBlobRestCache(providers: IProviders) {
  const { config } = providers;

  const blobCache = new BlobCache({
    ...config.github.cache.blob,
    tokenCredential: tryGetEntraApplicationTokenCredential(providers, 'caching'),
  });
  await blobCache.initialize();
  providers.cacheProvider = blobCache;
}
