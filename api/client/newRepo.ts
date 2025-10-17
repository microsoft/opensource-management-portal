//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { NextFunction, Response, Router } from 'express';
const router: Router = Router();

import { getProviders } from '../../lib/transitional.js';
import { jsonError } from '../../middleware/jsonError.js';

import newOrgRepo from './newOrgRepo.js';
import { ReposAppRequest } from '../../interfaces/index.js';

router.use('/org/:org', (req: ReposAppRequest, res: Response, next: NextFunction) => {
  const orgName = req.params.org;
  const { operations } = getProviders(req);
  try {
    req.organization = operations.getOrganization(orgName);
  } catch (noOrganization) {
    return next(
      jsonError(new Error('This API endpoint is not configured for the provided organization name.'))
    );
  }
  return next();
});

router.use('/org/:org', newOrgRepo);

export default router;
