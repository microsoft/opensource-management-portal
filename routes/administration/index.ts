//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { Router } from 'express';
import asyncHandler from 'express-async-handler';
const router: Router = Router();

import { ReposAppRequest } from '../../interfaces';
import { getProviders } from '../../transitional';

import getCompanySpecificDeployment from '../../middleware/companySpecificDeployment';

import RouteApp from './app';
import RouteApps from './apps';

router.use('*', asyncHandler(async function (req: ReposAppRequest, res, next) {
  const { corporateAdministrationProfile } = getProviders(req);
  if (corporateAdministrationProfile && corporateAdministrationProfile.urls) {
    req.individualContext.setInitialViewProperty('_corpAdminUrls', corporateAdministrationProfile.urls);
  }
  return next();
}));

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

router.get('/', (req: ReposAppRequest, res, next) => {
  const individualContext = req.individualContext;
  individualContext.webContext.render({
    view: 'administration',
    title: 'Administration',
    state: {
      // nothing
    },
  });
});

router.get('/unlinked-user-report', async (req: ReposAppRequest, res, next) => {
  try {
    const { operations: { organizations } } = getProviders(req);
  
    const checks = [];
    
    for (let [key, value] of organizations.entries()) {
      checks.push(value.getUnlinkedMembers().then(unlinkedMembers => {
        return unlinkedMembers.map(unlinkedMember => {
          return [
            unlinkedMember.id, unlinkedMember.login, key
          ];
        });
      }));
    };
    
    const results = await Promise.all(checks);
    
    const unlinkedMembers = results.reduce((acc, entry) => {
      acc += `${entry.join(',')}\r\n`
      return acc
    },'id,login,organization\r\n');

    res.header('Content-Type', 'text/csv');
    res.attachment('unlinked-user-report.csv');
    res.send(unlinkedMembers);
  } catch (err) {
    next(err);
  }
});

export default router;
