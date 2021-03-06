//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import express from 'express';
import asyncHandler from 'express-async-handler';

import { apiContextMiddleware, AddLinkToRequest, requireAccessTokenClient, setIdentity, jsonError } from '../../middleware';
import { ReposAppRequest } from '../../transitional';

import getCompanySpecificDeployment from '../../middleware/companySpecificDeployment';

import RouteClientNewRepo from './newRepo';

const router = express.Router();

router.use((req: ReposAppRequest, res, next) => {
  return req.isAuthenticated() ? next() : next(jsonError('Session is not authenticated', 401));
});

router.use(asyncHandler(requireAccessTokenClient));
router.use(apiContextMiddleware);
router.use(setIdentity);
router.use(asyncHandler(AddLinkToRequest));

router.use('/newRepo', RouteClientNewRepo);

const dynamicStartupInstance = getCompanySpecificDeployment();
dynamicStartupInstance?.routes?.connectCorporateApiRoutes && dynamicStartupInstance.routes.connectCorporateApiRoutes(router);

router.use((req, res, next) => {
  return next(jsonError('The resource or endpoint you are looking for is not there', 404));
});

export default router;
