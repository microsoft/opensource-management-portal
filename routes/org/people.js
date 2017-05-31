//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

const express = require('express');
const router = express.Router();

const peopleSearch = require('../peopleSearch');

router.use(function (req, res, next) {
  req.oss.addBreadcrumb(req, 'People');
  req.reposContext = {
    section: 'people',
    org: req.org,
    organization: req.org, // hack
    pivotDirectlyToOtherOrg: '/people/', // hack
  };
  next();
});

router.use(peopleSearch);

module.exports = router;
