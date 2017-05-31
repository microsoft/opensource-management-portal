//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

const express = require('express');
const jsonError = require('../jsonError');
const router = express.Router();

router.use((req, res, next) => {
  if (req.isAuthenticated()) {
    return next();
  }
  return next(jsonError('The current session is not authenticated', 401));
});

router.use('/newRepo', require('./newRepo'));
router.use('/metrics', require('./metrics'));

router.use((req, res, next) => {
  return next(jsonError('The resource or endpoint you are looking for is not there', 404));
});

module.exports = router;
