//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import Debug from 'debug';
import { fileURLToPath } from 'url';
import path from 'path';

import { startupWebStack } from '../index.js';

const debugInitialization = Debug.debug('startup');

const filename = fileURLToPath(import.meta.url);
const dirname = path.dirname(filename);

const args = process.argv;
if (args.includes('--sidecar') || process.env.OSMP_SIDECAR) {
  // this is some Microsoft-internal code for an alternate web app
  debugInitialization('starting sidecar...');
  miseSidecarLoader();
} else {
  startupWebStack({
    success: async () => {
      debugInitialization('web app is up.');
    },
  });
}

async function miseSidecarLoader() {
  const relativeImport = path.join(dirname, '../microsoft/sites/mise-sidecar/bin/www.js');
  debugInitialization('loading mise-sidecar from ' + relativeImport);
  const { startupMiseSidecar } = await import(relativeImport);
  startupMiseSidecar();
}
