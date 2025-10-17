//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { NextFunction, Response, Router } from 'express';
const router: Router = Router();

import { ReposAppRequest } from '../interfaces/index.js';
import lowercaser from '../middleware/lowercaser.js';

import RouteReposPager from './reposPager.js';

router.use(function (req: ReposAppRequest, res: Response, next: NextFunction) {
  req.individualContext.webContext.pushBreadcrumb('Repositories');
  req.reposContext = {
    section: 'repos',
    pivotDirectlyToOtherOrg: '/repos/', // hack
  };
  req.reposPagerMode = 'orgs';
  next();
});

router.get('/', lowercaser(['sort', 'language', 'type', 'tt']), RouteReposPager);

export default router;
