//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

/*eslint no-console: ["error", { allow: ["log"] }] */

'use strict';

process.env.DEBUG = 'oss-redis,oss-github';

require('painless-config-resolver')().resolve((configurationError, config) => {
  if (configurationError) {
    throw configurationError;
  }
  require('./task')(config);
});
