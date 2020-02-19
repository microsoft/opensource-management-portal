//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

/*eslint no-console: ["error", { allow: ["log"] }] */

'use strict';

process.env.DEBUG = 'redis,restapi';

require('painless-config-resolver')().resolve((configurationError, config) => {
  if (configurationError) {
    throw configurationError;
  }
  require('./task')(config);
});
