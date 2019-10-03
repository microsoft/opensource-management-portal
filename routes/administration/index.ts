//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

import express from 'express';
import asyncHandler from 'express-async-handler';
import { ReposAppRequest } from '../../transitional';
const router = express.Router();

router.use('/app', require('./app'));
router.use('/apps', require('./apps'));

router.get('/', (req: ReposAppRequest, res, next) => {
  const individualContext = req.individualContext;
  individualContext.webContext.render({
    view: 'administration',
    title: 'Administration',
    state: {
      // nothing
    },
  });
});

module.exports = router;
