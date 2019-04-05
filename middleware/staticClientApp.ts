//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

/*eslint no-console: ["error", { allow: ["log", "error", "warn", "dir"] }] */

'use strict';
const debug = require('debug')('oss-initialize');
//const ospoOpenSourceReposClientDistPath = require('@ospo/opensource-repos-client');
//const ospoOpenSourceReposClientPackage = require('@ospo/opensource-repos-client/package.json');

export function StaticClientApp (app, express) {
  // Serve/host the static client app from the location reported by the private
  // NPM module for the Ember app

  //debug(`Hosting client version ${ospoOpenSourceReposClientPackage.version} from ${ospoOpenSourceReposClientDistPath}`);
  //app.use('/client', express.static(ospoOpenSourceReposClientDistPath));
  debug('NO NEW REPO CLIENT HOSTED OR AVAILABLE');
};
