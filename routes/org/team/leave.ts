//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { NextFunction, Response, Router } from 'express';
const router: Router = Router();

import { ReposAppRequest, UserAlertType } from '../../../interfaces/index.js';
import { Organization } from '../../../business/organization.js';
import { Team } from '../../../business/team.js';

interface ILocalRequest extends ReposAppRequest {
  team2?: any;
}

router.post('/', async (req: ILocalRequest, res: Response, next: NextFunction) => {
  const organization = req.organization as Organization;
  const team2 = req.team2 as Team;
  const username = req.individualContext.link.thirdPartyUsername;
  await team2.removeMembership(username);
  req.individualContext.webContext.saveUserAlert(
    `You've been successfully removed from ${team2.name}!`,
    'Remove',
    UserAlertType.Success
  );
  return res.redirect('/' + organization.name + '/teams');
});

export default router;
