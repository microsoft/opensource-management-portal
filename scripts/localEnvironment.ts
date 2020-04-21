//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

/*eslint no-console: ["error", { allow: ["warn", "log", "dir"] }] */

// The local environment script is designed to allow for local debugging, test and
// development scenarios. The go method is called with resolved configuration.

async function go(providers: IProviders): Promise<void> {
  // ---------------------------------------------------------------------------










  // ---------------------------------------------------------------------------
}




















// -----------------------------------------------------------------------------
// Local script initialization
// -----------------------------------------------------------------------------
import App, { IReposApplication } from '../app';
import { IProviders } from '../transitional';
import { quitInAMinute } from '../utils';

console.log('Initializing the local environment...');

let painlessConfigResolver = null;
try {
  painlessConfigResolver = require('painless-config-resolver')();
} catch (error) {
  console.log('Painless config resolver initialization error:');
  console.dir(error);
  throw error;
}

painlessConfigResolver.resolve((configurationError, config) => {
  if (configurationError) {
    throw configurationError;
  }
  return initialize(config);
});

function initialize(config) {
  console.log('Local configuration ready, initializing non-web app pipeline...');
  App.initializeJob(config, null, error => {
    if (error) {
      throw error;
    }
    console.log('Local environment started.');
    return go(App.settings.providers as IProviders).then(ok => {
      console.log('Local environment script complete.');
      quitInAMinute(true);
    }).catch(error => {
      console.error(error);
      console.dir(error);
      quitInAMinute(false);
    });
  });
}
