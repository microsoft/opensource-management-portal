//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

import express = require('express');
import { ReposAppRequest } from '../transitional';
const router = express.Router();

const lowercaser = require('../middleware/lowercaser');

router.use(function (req: ReposAppRequest, res, next) {
  req.individualContext.webContext.pushBreadcrumb('Repositories');
  req.reposContext = {
    section: 'repos',
    pivotDirectlyToOtherOrg: '/repos/', // hack
  };
  req.reposPagerMode = 'orgs';
  next();
});

router.get('/', lowercaser(['sort', 'language', 'type', 'tt']), require('./reposPager'));

module.exports = router;
