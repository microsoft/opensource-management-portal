//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

var express = require('express');
var router = express.Router();
var utils = require('../../../utils');

var approvalsRoute = require('./approvals');
var membersRoute = require('./members');

router.use(function (req, res, next) {
  const teamPermissions = req.teamPermissions;
  if (!teamPermissions.allowAdministration) {
    const err = utils.wrapError(null, 'You do not have permission to maintain this team.', true);
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
