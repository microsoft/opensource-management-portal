//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

import express = require('express');
import { ReposAppRequest } from '../../../transitional';
const router = express.Router();
const teamAdminRequired = require('./teamAdminRequired');

interface ILocalRequest extends ReposAppRequest {
  team2?: any;
}

router.post('/', teamAdminRequired, async (req: ILocalRequest, res, next) => {
  const organization = req.organization;
  const team2 = req.team2;
  try {
    await team2.delete(); // returns now promise
    req.individualContext.webContext.saveUserAlert(`${team2.name} team deleted`, 'Delete', 'success');
    return res.redirect('/' + organization.name + '/teams');
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
