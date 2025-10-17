//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { NextFunction, Response, Router } from 'express';
const router: Router = Router();

import { ReposAppRequest } from '../../interfaces/index.js';
import { getProviders } from '../../lib/transitional.js';

import getCompanySpecificDeployment from '../../middleware/companySpecificDeployment.js';

import RouteApp from './app.js';
import RouteApps from './apps.js';

router.use('/*splat', async function (req: ReposAppRequest, res: Response, next: NextFunction) {
  const { corporateAdministrationProfile } = getProviders(req);
  if (corporateAdministrationProfile && corporateAdministrationProfile.urls) {
    req.individualContext.setInitialViewProperty('_corpAdminUrls', corporateAdministrationProfile.urls);
  }
  return next();
});

try {
  const dynamicStartupInstance = getCompanySpecificDeployment();
  const profile = dynamicStartupInstance?.administrationSection;
  if (profile && profile.setupRoutes) {
    profile.setupRoutes(router);
  }
} catch (error) {
  console.dir(error);
}
router.use('/app', RouteApp);
router.use('/apps', RouteApps);

router.get('/', (req: ReposAppRequest, res: Response, next: NextFunction) => {
  const individualContext = req.individualContext;
  individualContext.webContext.render({
    view: 'administration',
    title: 'Administration',
    state: {
      // nothing
    },
  });
});

export default router;
