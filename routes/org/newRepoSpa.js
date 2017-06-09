//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

const express = require('express');
const router = express.Router();

router.get('/', function (req, res) {
  const organization = req.organization;
  const orgName = organization.name.toLowerCase();
  req.legacyUserContext.render(req, res, 'org/newRepoSpa', 'New repository', {
    orgName: orgName,
    organization: organization,
  });
});

module.exports = router;
