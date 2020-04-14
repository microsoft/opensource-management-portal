//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

import express = require('express');
import { RequestWithSystemwidePermissions } from '../../transitional';

import { buildConsolidatedMap as buildRecipientMap } from '../../jobs/reports/consolidated';
import { IndividualContext } from '../../user';

// const buildRecipientMap = require('../../jobs/reports/consolidated').buildRecipientMap;
import RedisHelper from '../../lib/caching/redis';
const router = express.Router();
const systemWidePermissionsMiddleware = require('../../middleware/github/systemWidePermissions');

router.use(systemWidePermissionsMiddleware);

interface IRequestWithDigestReports extends RequestWithSystemwidePermissions {
  availableReports?: any;
}

router.use((req: IRequestWithDigestReports, res, next) => {
  const context = req.individualContext as IndividualContext;

  let upn = context && context.corporateIdentity ? context.corporateIdentity.username : null;
  if (!upn) {
    return next(new Error('Must have an active corporate link'));
  }

  const systemWidePermissions = req.systemWidePermissions;

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
    if (!error && !consolidatedReport) {
      error = new Error('No recent report is currently available for your account');
    }
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

router.get('/administrator/:id', (req: IRequestWithDigestReports, res, next) => {
  const id = req.params.id;
  const availableReports = req.availableReports;
  for (let i = 0; i < availableReports.length; i++) {
    const availableReport = availableReports[i];
    if (availableReport.id === id) {
      return req.individualContext.webContext.render({
        view: 'settings/digestReportView',
        title: availableReport.description,
        state: {
          reportTitle: availableReport.description,
          github: {
            consolidated: availableReport.report,
          },
        },
      });
    }
  }
  return next(new Error('Not found'));
});

router.get('/', (req: IRequestWithDigestReports, res) => {
  const availableReports = req.availableReports;
  req.individualContext.webContext.render({
    view: 'settings/digestReports',
    title: 'Reports',
    state: {
      availableReports,
    },
  });
});

module.exports = router;
