//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

/* eslint no-console: ["error", { allow: ["log"] }] */

// Kill bit if this takes more than 90 minutes
setTimeout(() => {
  console.log('Kill bit at 90m');
  process.exit(0);
}, 1000 * 60 * 90);

import moment from 'moment';

const started = moment().utc();
const startedString = started.format();

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

  if (config && config.github && config.github.jobs && config.github.jobs.reports && config.github.jobs.reports.enabled === true) {
    require('./task')(started, startedString, config);
  } else {
    console.log('Reports job is configured to skip execution.');
    process.exit(0);
  }
});
