//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { NextFunction, Response, Router } from 'express';
const router: Router = Router();

import { getProviders } from '../lib/transitional.js';
import { ReposAppRequest } from '../interfaces/index.js';

import RoutePeopleSearch from './peopleSearch.js';
import MiddlewareSystemWidePermissions from '../middleware/github/systemWidePermissions.js';

router.use(function (req: ReposAppRequest, res: Response, next: NextFunction) {
  req.individualContext.webContext.pushBreadcrumb('People');
  req.reposContext = {
    section: 'people',
    pivotDirectlyToOtherOrg: '/people/', // hack
  };
  next();
});

// Campaign-related redirect to take the user to GitHub
router.get('/github/:login', (req: ReposAppRequest, res: Response, next: NextFunction) => {
  const providers = getProviders(req);
  if (!providers || !providers.campaign) {
    return next();
  }
  return providers.campaign.redirectGitHubMiddleware(req, res, next, () => {
    const login = req.params.login;
    return login ? login : null;
  });
});

router.use(MiddlewareSystemWidePermissions);

router.use(RoutePeopleSearch);

export default router;
