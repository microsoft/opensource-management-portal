//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

/*eslint no-console: ["error", { allow: ["warn", "dir", "log"] }] */

import { IProviders, ErrorHelper } from '../../transitional';
import { sleep, asNumber } from '../../utils';
import BlobCache from '../../lib/caching/blob';

export function run(config: any, reclassify: boolean) {
  const app = require('../../app');
  config.skipModules = new Set([
    'web',
  ]);
  app.initializeJob(config, null, (error) => {
    if (error) {
      throw error;
    }
    go(config, app).then(done => {
      console.log('done');
      process.exit(0);
    }).catch(error => {
      throw error;
    });
  });
};

async function go(config, app) : Promise<void> {
  const providers = app.settings.providers as IProviders;
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
`)
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
}
