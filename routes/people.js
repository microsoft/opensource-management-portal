//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

const express = require('express');
const router = express.Router();

const peopleSearch = require('./peopleSearch');
const systemWidePermissionsMiddleware = require('../middleware/github/systemWidePermissions');

router.use(function (req, res, next) {
  req.legacyUserContext.addBreadcrumb(req, 'People');
  req.reposContext = {
    section: 'people',
    pivotDirectlyToOtherOrg: '/people/', // hack
  };
  next();
});

router.use(systemWidePermissionsMiddleware);

router.use(peopleSearch);

module.exports = router;
