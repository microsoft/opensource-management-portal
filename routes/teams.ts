//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { NextFunction, Response, Router } from 'express';
const router: Router = Router();

import lowercaser from '../middleware/lowercaser';
import { ReposAppRequest } from '../interfaces';

import RouteTeamsPager from './teamsPager';

router.use(function (req: ReposAppRequest, res: Response, next: NextFunction) {
  req.individualContext.webContext.pushBreadcrumb('Teams');
  req.reposContext = {
    section: 'teams',
    pivotDirectlyToOtherOrg: '/teams/', // hack
  };
  req.teamsPagerMode = 'orgs';
  next();
});

router.get('/', lowercaser(['sort', 'set']), RouteTeamsPager);

export default router;
