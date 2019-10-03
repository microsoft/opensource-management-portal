//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

import express = require('express');
import { ReposAppRequest } from '../../transitional';
const router = express.Router();

router.get('/', function (req: ReposAppRequest, res) {
  const organization = req.organization;
  const orgName = organization.name.toLowerCase();
  req.individualContext.webContext.render({
    view: 'emberApp',
    title: 'New repository',
    state: {
      orgName: orgName,
      organization: organization,
    },
  });
});

module.exports = router;
