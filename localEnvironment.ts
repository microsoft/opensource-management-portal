//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

/*eslint no-console: ["error", { allow: ["warn", "log", "dir"] }] */

// The local environment script is designed to allow for local debugging, test and
// development scenarios. It will fully initialize a non-web pipeline with configuration
// resolved.

function localEnvironment(app, config) {
  const providers = app.get('providers');
  console.dir(Object.getOwnPropertyNames(providers));

  // ---------------------------------------------------------------------------
  // Local environment script
  // ---------------------------------------------------------------------------












  // ---------------------------------------------------------------------------
}

// -----------------------------------------------------------------------------
// Initialization
// -----------------------------------------------------------------------------
console.log('Initializing the local environment...');
require('painless-config-resolver')().resolve((configurationError, config) => {
  if (configurationError) {
    throw configurationError;
  }
  return initialize(config);
});

function initialize(config) {
  console.log('Local configuration ready, initializing non-web app pipeline...');

  const app = require('./app');
  config.skipModules = new Set([
    'web',
  ]);

  app.initializeApplication(config, null, error => {
    if (error) {
      throw error;
    }
    console.log('Local environment started.');
    return localEnvironment(app, config);
  });
}
