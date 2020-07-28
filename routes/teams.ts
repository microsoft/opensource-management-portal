//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import express from 'express';
import { ReposAppRequest } from '../transitional';
const router = express.Router();
const lowercaser = require('../middleware/lowercaser');

router.use(function (req: ReposAppRequest, res, next) {
  req.individualContext.webContext.pushBreadcrumb('Teams');
  req.reposContext = {
    section: 'teams',
    pivotDirectlyToOtherOrg: '/teams/', // hack
  };
  req.teamsPagerMode = 'orgs';
  next();
});

router.get('/', lowercaser(['sort', 'set']), require('./teamsPager'));

module.exports = router;
