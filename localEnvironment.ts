//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

import { IProviders } from './transitional';
import { RepositoryMetadataEntity } from './entities/repositoryMetadata/repositoryMetadata';
import { PersonalAccessToken } from './entities/token/token';
import { LocalExtensionKey } from './entities/localExtensionKey/localExtensionKey';

/*eslint no-console: ["error", { allow: ["warn", "log", "dir"] }] */

// The local environment script is designed to allow for local debugging, test and
// development scenarios. It will fully initialize a non-web pipeline with configuration
// resolved.

async function localEnvironment(app, config): Promise<void> {
  const providers = app.get('providers') as IProviders;
  // console.dir(Object.getOwnPropertyNames(providers));

  // ---------------------------------------------------------------------------
  // Local environment script
  // ---------------------------------------------------------------------------

  // const contosoOrg = providers.operations.getOrganization('azure');
  // const s = contosoOrg.getDynamicSettings();
  // s.features.push('new-repository-lockdown-system');
  // await providers.organizationSettingsProvider.updateOrganizationSetting(s);

  return;
}


// -----------------------------------------------------------------------------
// Initialization
// -----------------------------------------------------------------------------
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

  const app = require('./app');
  config.skipModules = new Set([
    'web',
  ]);

  app.initializeApplication(config, null, error => {
    if (error) {
      throw error;
    }
    console.log('Local environment started.');
    return localEnvironment(app, config).then(ok => {
      console.log('OK');
      process.exit(0);
    }).catch(error => {
      console.error(error);
      console.dir(error);
      process.exit(1);
    });
  });
}
