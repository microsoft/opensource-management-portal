//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

const express = require('express');
const jsonError = require('../jsonError');
const newOrgRepo = require('./newOrgRepo');
const router = express.Router();

router.use('/org/:org', (req, res, next) => {
  const orgName = req.params.org;
  const operations = req.app.settings.providers.operations;
  try {
    req.organization = operations.getOrganization(orgName);
  } catch (noOrganization) {
    return next(jsonError(new Error('This API endpoint is not configured for the provided organization name.')));
  }
  return next();
});

router.use('/org/:org', newOrgRepo);

module.exports = router;
