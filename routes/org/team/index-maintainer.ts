//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { NextFunction, Response, Router } from 'express';

import { ReposAppRequest } from '../../../interfaces/index.js';
import { wrapError } from '../../../lib/utils.js';
const router: Router = Router();

import RouteApprovals from './approvals.js';
import RouteMembers from './members.js';

interface ILocalRequest extends ReposAppRequest {
  teamPermissions?: any;
}

router.use(function (req: ILocalRequest, res: Response, next: NextFunction) {
  const teamPermissions = req.teamPermissions;
  if (!teamPermissions.allowAdministration) {
    const err = wrapError(null, 'You do not have permission to maintain this team.', true);
    err.detailed = "These aren't the droids you are looking for.";
    err.status = 403;
    err.skipLog = true;
    return next(err);
  }

  return next();
});

router.use('/approvals', RouteApprovals);
router.use('/members', RouteMembers);

export default router;
