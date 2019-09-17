//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

import express = require('express');
import { ReposAppRequest } from '../../../transitional';
import { ILocalTeamRequest } from './members';
const router = express.Router();
const teamAdminRequired = require('./teamAdminRequired');
const PeopleSearch = require('../../peopleSearch')

interface ILocalRequest extends ReposAppRequest {
  team2?: any;
  verifiedCurrentMaintainers?: any;
  teamUrl?: any;
  team2AddType?: any;
}

function refreshMaintainers(team2) {
  const options = {
    maxAgeSeconds: 1,
    backgroundRefresh: false,
  };
  return team2.getMaintainers(options);
}

router.use(async (req: ILocalRequest, res, next) => {
  // Get the latest maintainers with every request
  const team2 = req.team2;
  try {
    const maintainers = await refreshMaintainers(team2); // returns now promise
    if (maintainers) {
      req.verifiedCurrentMaintainers = maintainers;
    };
    return next();
  } catch (error) {
    return next(error);
  };
});

router.get('/refresh', async (req: ILocalRequest, res) => {
  // Since the views are cached, this can help resolve support situations before they start
  await refreshMaintainers(req.team2); // returns now promise
  return res.redirect(req.teamUrl);
});

router.post('/:id/downgrade', teamAdminRequired, async (req: ILocalRequest, res, next) => {
  const team2 = req.team2;
  const id = req.params.id;
  const verifiedCurrentMaintainers = req.verifiedCurrentMaintainers;

  let maintainer = null;
  for (let i = 0; i < verifiedCurrentMaintainers.length; i++) {
    if (verifiedCurrentMaintainers[i].id == id /* less truthy, strings */) {
      maintainer = verifiedCurrentMaintainers[i];
      break;
    }
  }
  if (!maintainer) {
    return next(new Error(`The GitHub user with ID ${id} is not currently a maintainer of the team, so cannot be downgraded.`));
  }
  const username = maintainer.login;
  try {
    await team2.addMembership(username); // returns now promise
    req.individualContext.webContext.saveUserAlert(`Downgraded ${username} from a team maintainer to a team member`, team2.name + ' membership updated', 'success');
    await refreshMaintainers(team2); // returns now promise
    return res.redirect(req.teamUrl);
  } catch (err) {
    return next(err);
  };
});

router.use('/add', teamAdminRequired, (req: ILocalTeamRequest, res, next) => {
  req.team2AddType = 'maintainer';
  return next();
}, PeopleSearch);

router.post('/add', teamAdminRequired, async function (req: ILocalRequest, res, next) {
  const team2 = req.team2;
  const login = req.body.username;
  try {
    await team2.addMaintainer(login); // returns now promise
    req.individualContext.webContext.saveUserAlert(`Added ${login} as a team maintainer`, team2.name + ' membership updated', 'success');
    await refreshMaintainers(team2); // returns now promise
    return res.redirect(req.teamUrl);
  } catch (err) {
    return next(err);
  };
});

module.exports = router;
