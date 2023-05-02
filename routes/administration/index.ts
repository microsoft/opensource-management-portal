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

import { json2csvAsync } from 'json-2-csv';
import _ from 'lodash';

router.use(
  '*',
  asyncHandler(async function (req: ReposAppRequest, res, next) {
    const { corporateAdministrationProfile } = getProviders(req);
    if (corporateAdministrationProfile && corporateAdministrationProfile.urls) {
      req.individualContext.setInitialViewProperty('_corpAdminUrls', corporateAdministrationProfile.urls);
    }
    return next();
  })
);

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

/*
Returns a CSV of every org and its members, with a column indicating whether the member is linked or not
*/
router.get('/users-report', async (req: ReposAppRequest, res, next) => {
  try {
    const {
      operations: { organizations },
    } = getProviders(req);
    const checks = [];
    const users = {};

    for (const [orgName, org] of organizations.entries()) {
      checks.push(
        org.getUnlinkedAndLinkedMembers().then((memberPairs) => {
          memberPairs.forEach((memberPair) => {
            const {
              member: { id: UserId, login: UserLogin },
              link: memberLink,
            } = memberPair;
            const isLinked = memberLink ? true : false;
            let userObj = { UserLogin, UserId, Organizations: [], IsLinked: isLinked };

            if (isLinked) {
              const {
                corporateId: CorporateId,
                corporateMailAddress: CorporateMailAddress,
                corporateUsername: CorporateUsername,
                corporateAlias: CorporateAlias,
                corporateDisplayName: CorporateDisplayName,
              } = memberLink;

              userObj = {
                ...userObj,
                ...{
                  CorporateId,
                  CorporateUsername,
                  CorporateAlias,
                  CorporateDisplayName,
                  CorporateMailAddress,
                },
              };
            }

            users[UserLogin] = users[UserLogin] || userObj;
            users[UserLogin].Organizations.push(orgName);
          });
        })
      );
    }

    await Promise.all(checks);
    const header =
      'UserLogin,UserId,Organizations,IsLinked,CorporateId,CorporateMailAddress,CorporateUsername,CorporateAlias,CorporateDisplayName';
    const cleanedObjects: object[] = _.sortBy(Object.values(users), 'UserLogin');
    const payload = await json2csvAsync(cleanedObjects, { keys: header.split(','), emptyFieldValue: '' });

    res.header('Content-Type', 'text/csv');
    res.attachment('users-report.csv');
    res.send(payload);
  } catch (err) {
    next(err);
  }
});

export default router;
