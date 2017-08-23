//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

/* eslint no-console: ["error", { allow: ["log", "dir"] }] */

'use strict';

const painlessConfigResolver = require('painless-config-resolver')();

painlessConfigResolver.resolve((configurationError, config) => {
  console.log('configuration resolution attempted');

  if (configurationError) {
    throw configurationError;
  }

  console.log('sharing configured information - warning this may contain secrets in the output:');
  console.dir(config);
  process.exit(0);
});
