//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

// Job: System Team Permissions

import Job from './task';
import app from '../../app';

app.runJob(Job, {
  insightsPrefix: 'JobPermissions',
  defaultDebugOutput: 'cache,restapi',
});
