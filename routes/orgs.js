//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

const express = require('express');
const router = express.Router();
const orgRoute = require('./org/');
const utils = require('../utils');

router.use('/:orgName', function (req, res, next) {
  // This middleware contains both the original GitHub operations types
  // as well as the newer implementation. In time this will peel apart.
  const orgName = req.params.orgName;
  const operations = req.app.settings.operations;
  try {
    req.organization = operations.getOrganization(orgName);
    return next();
  } catch (ex) {
    if (orgName.toLowerCase() == 'account') {
      return res.redirect('/');
    }
    const err = utils.wrapError(null, 'Organization not found', true);
    err.status = 404;
    return next(err);
  }
});

router.use('/:orgName', orgRoute);

module.exports = router;
