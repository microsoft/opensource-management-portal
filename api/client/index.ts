//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { Router } from 'express';
import asyncHandler from 'express-async-handler';

import { apiContextMiddleware, AddLinkToRequest, requireAccessTokenClient, setIdentity, jsonError } from '../../middleware';
import { getProviders } from '../../transitional';

import getCompanySpecificDeployment from '../../middleware/companySpecificDeployment';

import { ReposAppRequest } from '../../interfaces';

import routeClientNewRepo from './newRepo';
import routeContext from './context';
import routeOrganizations from './organizations';
import routeLinking from './linking';
import routeSession from './session';
import routeBanner from './banner';
import routeNews from './news';
import routeCrossOrganizationPeople from './people';
import routeCrossOrganizationRepos from './repos';
import routeCrossOrganizationTeams from './teams';

const router: Router = Router();

router.use((req: ReposAppRequest, res, next) => {
  const { config } = getProviders(req);
  if (config?.features?.allowApiClient) {
    return req.isAuthenticated() ? next() : next(jsonError('Session is not authenticated', 401));
  }
  return next(jsonError('Client API features unavailable', 403));
});

router.use(asyncHandler(requireAccessTokenClient));
router.use(apiContextMiddleware);
router.use(setIdentity);
router.use(asyncHandler(AddLinkToRequest));

router.use('/newRepo', routeClientNewRepo);

router.use('/context', routeContext);

router.use('/banner', routeBanner);
router.use('/orgs', routeOrganizations);
router.use('/link', routeLinking);
router.use('/signout', routeSession);
router.use('/people', routeCrossOrganizationPeople);
router.use('/repos', routeCrossOrganizationRepos);
router.use('/teams', routeCrossOrganizationTeams);
router.use('/news', routeNews);

const dynamicStartupInstance = getCompanySpecificDeployment();
dynamicStartupInstance?.routes?.api?.index && dynamicStartupInstance?.routes?.api?.index(router);

router.use((req, res, next) => {
  return next(jsonError('The resource or endpoint you are looking for is not there', 404));
});

export default router;
