//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

// Every ten minutes, send an application insights metric indicating the app and VM memory use

const fileSize = require('file-size');
import os = require('os');

const hostname = os.hostname();

function everyMinute(insights) {
  const memoryUsage = process.memoryUsage();
  const osTotalMemory = os.totalmem();
  const osFreeMemory = os.freemem();

  const properties = {
    hostname: hostname,
    residentSetSize: fileSize(memoryUsage.rss).human(),
    heapTotalMemory: fileSize(memoryUsage.heapTotal).human(),
    heapUsedMemory: fileSize(memoryUsage.heapUsed).human(),
    externalMemory: fileSize(memoryUsage.external).human(),
    osTotalMemory: fileSize(osTotalMemory).human(),
    osFreeMemory: fileSize(osFreeMemory).human(),
  };
  insights.trackEvent({ name: 'NodeApplicationMemoryUse', properties: properties });

  insights.trackMetric({ name: 'NodeApplicationMemoryUseResident', value: memoryUsage.rss });
  insights.trackMetric({ name: 'NodeApplicationMemoryUseHeapTotal', value: memoryUsage.heapTotal });
  insights.trackMetric({ name: 'NodeApplicationMemoryUseHeapUsed', value: memoryUsage.heapUsed });
  insights.trackMetric({ name: 'NodeApplicationMemoryUseExternal', value: memoryUsage.external });
  insights.trackMetric({ name: 'NodeApplicationMemoryUseOSTotal', value: osTotalMemory });
  insights.trackMetric({ name: 'NodeApplicationMemoryUseOSFree', value: osFreeMemory });
}

function initialize(insights) {
  if (insights) {
    const report = everyMinute.bind(null, insights);
    setInterval(report, 1000 * 60 * 10);
    report();
  }
}

module.exports = {
  initialize: initialize,
};
