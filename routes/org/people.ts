//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

import express = require('express');
import { ReposAppRequest } from '../../transitional';
const router = express.Router();

const peopleSearch = require('../peopleSearch');

router.use(function (req:ReposAppRequest, res, next) {
  req.individualContext.webContext.pushBreadcrumb('People');
  req.reposContext = {
    section: 'people',
    organization: req.organization,
    pivotDirectlyToOtherOrg: '/people/', // hack
  };
  next();
});

router.use(peopleSearch);

module.exports = router;
