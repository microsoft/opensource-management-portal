'use strict';

import express = require('express');
import { ReposAppRequest } from '../../../transitional';
const router = express.Router();

interface ILocalRequest extends ReposAppRequest {
  team2?: any;
}

router.post('/', async (req: ILocalRequest, res, next) => {
  const organization = req.organization;
  const team2 = req.team2;
  const username = req.individualContext.link.thirdPartyUsername;
  await team2.removeMembership(username).catch(error => {
    return next(error);
  }).then(ok => {
    req.individualContext.webContext.saveUserAlert(`You've been successfully removed from ${team2.name}!`, 'Remove', 'success');
    res.redirect('/' + organization.name + '/teams');
  });
});

module.exports = router; 