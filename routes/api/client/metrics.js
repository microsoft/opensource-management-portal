//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

const express = require('express');
const jsonError = require('../jsonError');
const metrics = require('../../../business/metrics');
const router = express.Router();

router.get('/all', (req, res, next) => {
  const config = req.app.settings.providers.config.metrics.azureStorage;
  metrics.retrieveFromAzureTable(config, 'all', null, (error, result) => {
    if (error) {
      return next(jsonError(error, 400));
    }
    res.json({ metrics: result });
  });
});

router.get('/orgs', (req, res, next) => {
  const config = req.app.settings.providers.config.metrics.azureStorage;
  metrics.retrieveFromAzureTable(config, 'orgs', null, (error, result) => {
    if (error) {
      return next(jsonError(error, 400));
    }
    res.json({ metrics: result });
  });
});

router.get('/orgs/:id', (req, res, next) => {
  const orgId = req.params.id;
  const config = req.app.settings.providers.config.metrics.azureStorage;
  metrics.retrieveFromAzureTable(config, 'orgs', orgId, (error, result) => {
    if (error) {
      return next(jsonError(error, 400));
    }
    res.json({ metrics: result });
  });
});

router.get('/repos', (req, res, next) => {
  const config = req.app.settings.providers.config.metrics.azureStorage;
  metrics.retrieveFromAzureTable(config, 'repos', null, (error, result) => {
    if (error) {
      return next(jsonError(error, 400));
    }
    res.json({ metrics: result });
  });
});

router.get('/repos/:id', (req, res, next) => {
  const repoId = req.params.id;
  const config = req.app.settings.providers.config.metrics.azureStorage;
  metrics.retrieveFromAzureTable(config, 'repos', repoId, (error, result) => {
    if (error) {
      return next(jsonError(error, 400));
    }
    res.json({ metrics: result });
  });
});

router.get('/repos/org/:id', (req, res, next) => {
  const orgId = req.params.id;
  const config = req.app.settings.providers.config.metrics.azureStorage;
  metrics.retrieveFromAzureTable(config, `org:${orgId}`, null, (error, result) => {
    if (error) {
      return next(jsonError(error, 400));
    }
    res.json({ metrics: result });
  });
});

module.exports = router;
