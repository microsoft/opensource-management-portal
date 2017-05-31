//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

// Every minute, send an application insights metric indicating how long this
// has been running.

const moment = require('moment');

function everyMinute(insights, started) {
  const now = moment();
  const minutes = now.diff(started, 'minutes');
  insights.trackMetric('NodeApplicationUptime', minutes);
}

function initialize(insights) {
  if (insights) {
    const started = moment();
    const report = everyMinute.bind(null, insights, started);
    setInterval(report, 1000 * 60);
  }
}

module.exports = {
  initialize: initialize,
};
