//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

const express = require('express');

const buildRecipientMap = require('../../jobs/reports/consolidated').buildRecipientMap;
const RedisHelper = require('../../lib/redis');
const router = express.Router();
const systemWidePermissionsMiddleware = require('../../middleware/github/systemWidePermissions');

router.use(systemWidePermissionsMiddleware);

router.use((req, res, next) => {
  const link = req.link;
  const systemWidePermissions = req.systemWidePermissions;

  let upn = link.aadupn;
  if (!upn) {
    return next(new Error('Must have an active Active Directory link'));
  }

  // For performance reasons, this current implementation only works
  // when the Redis server is the same for both reports and the
  // app

  const providers = req.app.settings.providers;
  const config = providers.config;

  let reportRedisClient = null;
  if (providers.witnessRedis) {
    reportRedisClient = new RedisHelper(providers.witnessRedis);
  } else if (config.witness && config.witness.redis && config.witness.redis.tls && config.witness.redis.tls === config.redis.tls) {
    reportRedisClient = new RedisHelper(providers.redisClient);
  }
  const reportConfig = config && config.github && config.github.jobs ? config.github.jobs.reports : {};
  if (!reportRedisClient || !reportConfig || !reportConfig.witnessEventKey) {
    return next(new Error('Digest report storage is not enabled for this environment. Reports are not available to be viewed on-demand.'));
  }

  const availableReports = [];
  req.availableReports = availableReports;
  return reportRedisClient.getObjectCompressed(reportConfig.witnessEventKey, (error, consolidatedReport) => {
    if (error) {
      return next(error);
    }
    const generated = consolidatedReport.metadata.startedText || 'recently';
    const reportsByRecipient = buildRecipientMap(consolidatedReport);

    // Hard-coded
    const administratorUpn = 'upn:msftgits@microsoft.com';
    const administratorReport = reportsByRecipient.get(administratorUpn);
    if (systemWidePermissions.allowAdministration && administratorReport) {
      availableReports.push({
        description: `Microsoft-wide report as of ${generated}`,
        id: administratorUpn,
        report: administratorReport,
      });
    }

    const reportIndex = `upn:${upn.toLowerCase()}`;
    const userReport = reportsByRecipient.get(reportIndex);
    if (userReport) {
      availableReports.push({
        description: `Your administrator's report as of ${generated}`,
        report: userReport,
        id: reportIndex,
      });
    }

    return next();
  });
});

router.get('/administrator/:id', (req, res, next) => {
  const id = req.params.id;
  const availableReports = req.availableReports;
  for (let i = 0; i < availableReports.length; i++) {
    const availableReport = availableReports[i];
    if (availableReport.id === id) {
      return req.legacyUserContext.render(req, res, 'settings/digestReportView', availableReport.description, {
        reportTitle: availableReport.description,
        github: {
          consolidated: availableReport.report,
        },
      });
    }
  }
  return next(new Error('Not found'));
});

router.get('/', (req, res) => {
  const availableReports = req.availableReports;

  req.legacyUserContext.render(req, res, 'settings/digestReports', 'Reports', {
    availableReports: availableReports,
  });
});

module.exports = router;
