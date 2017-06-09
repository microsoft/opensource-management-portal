//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

const express = require('express');
const router = express.Router();
const teamAdminRequired = require('./teamAdminRequired');

router.post('/', teamAdminRequired, (req, res, next) => {
  const organization = req.organization;
  const team2 = req.team2;
  team2.delete(error => {
    if (error) {
      return next(error);
    }
    req.legacyUserContext.saveUserAlert(req, `${team2.name} team deleted`, 'Delete', 'success');
    res.redirect('/' + organization.name + '/teams');
  });
});

module.exports = router;
