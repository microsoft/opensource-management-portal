//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

/*eslint no-console: ["error", { allow: ["log"] }] */

'use strict';

import moment = require('moment');

// Kill bit if this takes more than 90 minutes
setTimeout(() => {
  console.log('Kill bit at 90m');
  process.exit(0);
}, 1000 * 60 * 90);

// To skip this WebJob, setting WEBJOB_REPOS_CLEANUP_INVITES_SKIP should be set to '1'
if (process.env.WEBJOB_REPOS_CLEANUP_INVITES_SKIP == '1' /* loose */) {
  console.log('Organization invitation cleanup job is configured to skip execution.');
  process.exit(0);
}

process.env.DEBUG = 'oss-github';

const started = moment().utc();
const startedString = started.format();

const painlessConfigResolver = require('painless-config-resolver')();

painlessConfigResolver.resolve((configurationError, config) => {
  if (configurationError) {
    throw configurationError;
  }
  require('./task')(config);
});
