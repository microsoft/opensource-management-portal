//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import express = require('express');
import { ReposAppRequest } from '../../../transitional';
import { wrapError } from '../../../utils';
var router = express.Router();
var utils = require('../../../utils');

var approvalsRoute = require('./approvals');
var membersRoute = require('./members');

interface ILocalRequest extends ReposAppRequest {
  teamPermissions?: any;
}

router.use(function (req: ILocalRequest, res, next) {
  const teamPermissions = req.teamPermissions;
  if (!teamPermissions.allowAdministration) {
    const err = wrapError(null, 'You do not have permission to maintain this team.', true);
    err.detailed = 'These aren\'t the droids you are looking for.';
    err.status = 403;
    err.skipLog = true;
    return next(err);
  }

  return next();
});

router.use('/approvals', approvalsRoute);
router.use('/members', membersRoute);

module.exports = router;
