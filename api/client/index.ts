//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import express from 'express';
import asyncHandler from 'express-async-handler';

import { jsonError } from '../../middleware/jsonError';
import { apiContextMiddleware } from '../../middleware/business/setContext';
import { setIdentity } from '../../middleware/business/authentication';
import { AddLinkToRequest } from '../../middleware/links';
import { ReposAppRequest } from '../../transitional';

import ReleaseApprovalsRoute from './releaseApprovals';

const router = express.Router();

router.use((req: ReposAppRequest, res, next) => {
  if (req.isAuthenticated()) {
    return next();
  }
  return next(jsonError('The current session is not authenticated', 401));
});

router.use(apiContextMiddleware);
router.use(setIdentity);
router.use(asyncHandler(AddLinkToRequest));

router.use('/newRepo', require('./newRepo'));
router.use('/releaseApprovals', ReleaseApprovalsRoute);

router.use((req, res, next) => {
  return next(jsonError('The resource or endpoint you are looking for is not there', 404));
});

export default router;
