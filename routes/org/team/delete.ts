//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

import express from 'express';
import { ReposAppRequest } from '../../../transitional';
const router = express.Router();
const teamAdminRequired = require('./teamAdminRequired');

interface ILocalRequest extends ReposAppRequest {
  team2?: any;
}

router.post('/', teamAdminRequired, (req: ILocalRequest, res, next) => {
  const organization = req.organization;
  const team2 = req.team2;
  team2.delete(error => {
    if (error) {
      return next(error);
    }
    req.individualContext.webContext.saveUserAlert(`${team2.name} team deleted`, 'Delete', 'success');
    res.redirect('/' + organization.name + '/teams');
  });
});

module.exports = router;
