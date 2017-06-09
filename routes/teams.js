//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

const express = require('express');
const router = express.Router();
const lowercaser = require('../middleware/lowercaser');

router.use(function (req, res, next) {
  req.legacyUserContext.addBreadcrumb(req, 'Teams');
  req.reposContext = {
    section: 'teams',
    pivotDirectlyToOtherOrg: '/teams/', // hack
  };
  req.teamsPagerMode = 'orgs';
  next();
});

router.get('/', lowercaser(['sort', 'set']), require('./teamsPager'));

module.exports = router;
