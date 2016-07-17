//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

const express = require('express');
const router = express.Router();
const orgRoute = require('./org/');

router.use('/:orgName', function (req, res, next) {
  var oss = req.oss;
  var orgName = req.params.orgName;
  try {
    req.org = oss.org(orgName);
    next();
  } catch (ex) {
    if (orgName.toLowerCase() == 'account') {
      return res.redirect('/');
    }
    var err = new Error('Organization Not Found');
    err.status = 404;
    next(err);
  }
});

router.use('/:orgName', orgRoute);

module.exports = router;
