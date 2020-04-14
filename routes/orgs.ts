//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

import express = require('express');
import { IReposRequestWithOrganization } from '../transitional';
import { wrapError } from '../utils';
const router = express.Router();
const orgRoute = require('./org/');

router.use('/:orgName', function (req: IReposRequestWithOrganization, res, next) {
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
    const err = wrapError(null, 'Organization not found', true);
    err.status = 404;
    return next(err);
  }
});

router.use('/:orgName', orgRoute);

module.exports = router;
