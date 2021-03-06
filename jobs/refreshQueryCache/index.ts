//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import Job from './task';
import app from '../../app';

const killBitHours = 48;

app.runJob(Job, {
  defaultDebugOutput: 'querycache',
  timeoutMinutes: 60 * killBitHours,
  insightsPrefix: 'JobRefreshQueryCache',
});
