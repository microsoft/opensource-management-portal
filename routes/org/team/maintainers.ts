//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import express = require('express');
import asyncHandler from 'express-async-handler';
const router = express.Router();

import { ILocalTeamRequest } from './members';

import { ReposAppRequest } from '../../../transitional';
import { Team } from '../../../business/team';
import { TeamMember } from '../../../business/teamMember';
const teamAdminRequired = require('./teamAdminRequired');
const PeopleSearch = require('../../peopleSearch')

interface ILocalRequest extends ReposAppRequest {
  team2?: Team;
  verifiedCurrentMaintainers?: any;
  teamUrl?: any;
  team2AddType?: any;
}

router.use(asyncHandler(async (req: ILocalRequest, res, next) => {
  // Get the latest maintainers, forced, with every request
  const team2 = req.team2 as Team;
  const maintainers = await refreshMaintainers(team2);
  if (maintainers) {
    req.verifiedCurrentMaintainers = maintainers;
  }
  return next();
}));

async function refreshMaintainers(team2: Team): Promise<TeamMember[]> {
  return team2.getMaintainers({
    maxAgeSeconds: -1,
    backgroundRefresh: false,
  });
}

router.get('/refresh', async (req: ILocalRequest, res) => {
  // Since the views are cached, this can help resolve support situations before they start
  await refreshMaintainers(req.team2); // returns now promise
  return res.redirect(req.teamUrl);
});


router.post('/:id/downgrade', teamAdminRequired, asyncHandler(async (req: ILocalRequest, res, next) => {
  const team2 = req.team2 as Team;
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
  await team2.addMembership(username);
  req.individualContext.webContext.saveUserAlert(`Downgraded ${username} from a team maintainer to a team member`, team2.name + ' membership updated', 'success');
  const maintainers = await refreshMaintainers(team2);
  res.redirect(req.teamUrl);
}));

router.use('/add', teamAdminRequired, (req: ILocalTeamRequest, res, next) => {
  req.team2AddType = 'maintainer';
  return next();
}, PeopleSearch);

router.post('/add', teamAdminRequired, asyncHandler(async function (req: ILocalRequest, res, next) {
  const team2 = req.team2 as Team;
  const login = req.body.username;
  await team2.addMaintainer(login);
  req.individualContext.webContext.saveUserAlert(`Added ${login} as a team maintainer`, team2.name + ' membership updated', 'success');
  const maintainers = await refreshMaintainers(team2);
  return res.redirect(req.teamUrl);
}));

module.exports = router;
