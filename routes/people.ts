//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import express from 'express';
const router = express.Router();

import { ReposAppRequest } from '../transitional';

import RoutePeopleSearch from './peopleSearch';
import MiddlewareSystemWidePermissions from '../middleware/github/systemWidePermissions';

router.use(function (req: ReposAppRequest, res, next) {
  req.individualContext.webContext.pushBreadcrumb('People');
  req.reposContext = {
    section: 'people',
    pivotDirectlyToOtherOrg: '/people/', // hack
  };
  next();
});

// Campaign-related redirect to take the user to GitHub
router.get('/github/:login', (req: ReposAppRequest, res, next) => {
  if (!req.app.settings.providers || !req.app.settings.providers.campaign) {
    return next();
  }
  return req.app.settings.providers.campaign.redirectGitHubMiddleware(req, res, next, () => {
    const login = req.params.login;
    return login ? login : null;
  });
});


router.use(MiddlewareSystemWidePermissions);

router.use(RoutePeopleSearch);

export default router;
