//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import express from 'express';
import { ReposAppRequest } from '../../transitional';
import { jsonError } from '../../middleware/jsonError';

import newOrgRepo from './newOrgRepo';
const router = express.Router();

router.use('/org/:org', (req: ReposAppRequest, res, next) => {
  const orgName = req.params.org;
  const operations = req.app.settings.providers.operations;
  try {
    req.organization = operations.getOrganization(orgName);
  } catch (noOrganization) {
    return next(jsonError(new Error('This API endpoint is not configured for the provided organization name.')));
  }
  return next();
});

router.use('/org/:org', newOrgRepo);

export default router;
