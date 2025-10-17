//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

// Job 17: Cleanup blob cache

import BlobCache from '../lib/caching/blob.js';
import job from '../job.js';
import type { IProviders } from '../interfaces/index.js';

const INSIGHTS_PREFIX = 'JobCleanupBlobCache';

job.runBackgroundJob(cleanup);

async function cleanup(providers: IProviders): Promise<void> {
  const { insights } = providers;
  insights?.trackEvent({
    name: `${INSIGHTS_PREFIX}Start`,
    properties: {
      time: new Date(),
    },
  });
  for (const providerName in providers) {
    const provider = providers[providerName];
    if (provider && provider['expiringBlobCache']) {
      const expiringBlobCache = provider['expiringBlobCache'] as BlobCache;
      if (expiringBlobCache && expiringBlobCache.deleteExpiredBlobs) {
        console.log(`blob cache found: ${providerName}`);
        try {
          const stats = await expiringBlobCache.deleteExpiredBlobs();
          console.log(`
Provider name:   ${providerName}
Expired blobs:   ${stats.expired}
Blobs processed: ${stats.processedBlobs}
Pages processed: ${stats.processedPages}
Errors:          ${stats.errors.length}
`);
          if (stats.errors.length) {
            console.dir(stats.errors);
          }
        } catch (expiringDeleteError) {
          console.log(`Unhandled error while deleting expiring blobs for provider ${providerName}`);
          console.dir(expiringDeleteError);
        }
      }
    }
  }
  insights?.trackEvent({
    name: `${INSIGHTS_PREFIX}End`,
    properties: {
      time: new Date(),
    },
  });
}
