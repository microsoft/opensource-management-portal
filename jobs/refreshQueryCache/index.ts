//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

/*eslint no-console: ["error", { allow: ["log"] }] */

'use strict';

// Kill bit if this takes more than 120 minutes
setTimeout(() => {
  console.log('Kill bit at 120m');
  process.exit(0);
}, 1000 * 60 * 120);

require('painless-config-resolver')().resolve((configurationError, config) => {
  if (configurationError) {
    throw configurationError;
  }
  require('./task')(config);
});
