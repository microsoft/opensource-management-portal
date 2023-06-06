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
Asynchronously returns a CSV file with of each user, the organizations they belong to, and whether they are linked or not
*/
router.get('/users-report', async (req: ReposAppRequest, res, next) => {
  try {
    // Use getProviders middleware to obtain operational data, which includes an array of organizations
    const {
      operations: { organizations },
    } = getProviders(req);
    const checks = [];
    const users = {};

    // Loop through each organization in the array
    for (const [orgName, org] of organizations.entries()) {
      // Get an array of owner logins for the org, which we'll use later
      const ownerLogins = (await org.getOwners()).map((owner) => owner.login);

      // Push a promise to the checks array, which will be resolved later with a result
      checks.push(
        // Calling this on an org returns an array of member pairs, each representing a GitHub user who is a member of the org
        org.getUnlinkedAndLinkedMembers().then((memberPairs) => {
          // Loop through each member pair in the array
          memberPairs.forEach((memberPair) => {
            // Extract the member object and the link object from the member pair object
            const {
              member: { id: UserId, login: UserLogin },
              link: memberLink,
            } = memberPair;

            // Store whether the member is linked or not in a variable
            const isLinked = memberLink ? true : false;

            // Create an object representing the user; we'll fill it in more later
            let userObj = {
              UserLogin,
              UserId,
              Organizations: [],
              OwnedOrganizations: [],
              IsLinked: isLinked,
            };

            // If the user is linked, add the fields from the memberLink object to the user object
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

            if (ownerLogins.includes(UserLogin)) {
              users[UserLogin].OwnedOrganizations.push(orgName);
            }
          });
        })
      );
    }
    // Wait for all of the promises in the checks array to be resolved
    await Promise.all(checks);
    // Define the header row for the CSV
    const header =
      'UserLogin,UserId,Organizations,OwnedOrganizations,IsLinked,CorporateId,CorporateMailAddress,CorporateUsername,CorporateAlias,CorporateDisplayName';

    // Sort the users object by user login and convert the values back into an array
    const cleanedObjects: object[] = _.sortBy(Object.values(users), 'UserLogin');

    // Use the json2csvAsync library to convert the cleaned array of user objects into a CSV payload
    const payload = await json2csvAsync(cleanedObjects, { keys: header.split(','), emptyFieldValue: '' });

    // Set up response headers to return a CSV file
    res.header('Content-Type', 'text/csv');
    res.attachment('users-report.csv');
    // Send the payload as the response body
    res.send(payload);
  } catch (err) {
    next(err);
  }
});

export default router;
