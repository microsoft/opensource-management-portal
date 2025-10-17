//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { NextFunction, Response, Router } from 'express';

import {
  AddRepositoryPermissionsToRequest,
  getContextualRepositoryPermissions,
} from '../../../../middleware/github/repoPermissions.js';
import { jsonError } from '../../../../middleware/index.js';
import getCompanySpecificDeployment from '../../../../middleware/companySpecificDeployment.js';
import { ReposAppRequest } from '../../../../interfaces/index.js';

import routeForkUnlock from './repoForkUnlock.js';

const router: Router = Router();

router.get(
  '/permissions',
  AddRepositoryPermissionsToRequest,
  async (req: ReposAppRequest, res: Response, next: NextFunction) => {
    const permissions = getContextualRepositoryPermissions(req);
    return res.json(permissions) as unknown as void;
  }
);

router.use('/manage/fork', routeForkUnlock);

const deployment = getCompanySpecificDeployment();
if (deployment?.routes?.api?.context?.organization?.repo) {
  deployment?.routes?.api?.context?.organization?.repo(router);
}

router.use('/*splat', (req, res: Response, next: NextFunction) => {
  return next(jsonError(`no API or ${req.method} function available for repo`, 404));
});

export default router;
