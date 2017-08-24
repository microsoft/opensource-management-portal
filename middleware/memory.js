//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

// Every ten minutes, send an application insights metric indicating the app and VM memory use

const fileSize = require('file-size');
const os = require('os');

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
  insights.trackEvent('NodeApplicationMemoryUse', properties);

  insights.trackMetric('NodeApplicationMemoryUseResident', memoryUsage.rss);
  insights.trackMetric('NodeApplicationMemoryUseHeapTotal', memoryUsage.heapTotal);
  insights.trackMetric('NodeApplicationMemoryUseHeapUsed', memoryUsage.heapUsed);
  insights.trackMetric('NodeApplicationMemoryUseExternal', memoryUsage.external);
  insights.trackMetric('NodeApplicationMemoryUseOSTotal', osTotalMemory);
  insights.trackMetric('NodeApplicationMemoryUseOSFree', osFreeMemory);
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
