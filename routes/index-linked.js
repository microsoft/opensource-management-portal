//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

const express = require('express');
const router = express.Router();

const approvalsSystem = require('./approvals');
const orgsRoute = require('./orgs');
const orgAdmin = require('./orgAdmin');
const peopleRoute = require('./people');
const reposRoute = require('./repos');
const teamsRoute = require('./teams');
const unlinkRoute = require('./unlink');
const utils = require('../utils');

//-----------------------------------------------------------------------------
//-----------------------------------------------------------------------------
// SECURITY ROUTE MARKER:
// Below this next call, all routes will require an active link to exist for
// the authenticated GitHub user.
//-----------------------------------------------------------------------------
//-----------------------------------------------------------------------------
router.use(function (req, res, next) {
  const config = req.app.settings.runtimeConfig;
  const link = req.legacyUserContext.entities.link;
  if (link && link.ghid) {
    next();
  } else if (config.authentication.scheme !== 'aad') {
    const error = new Error('Not found (not a corporate authenticated user).');
    error.status = 404;
    error.originalUrl = req.originalUrl;
    error.skipLog = true;
    error.detailed = 'You are not currently signed in as a user with a "linked" corporate identity, FYI.';
    next(error);
  } else {
    utils.storeOriginalUrlAsVariable(req, res, 'beforeLinkReferrer', '/', 'no linked github username');
  }
});
// end security route
//-----------------------------------------------------------------------------
//-----------------------------------------------------------------------------

router.use('/unlink', unlinkRoute);

router.use('/teams', teamsRoute);
router.use('/approvals', approvalsSystem);
router.use('/organization', orgAdmin);
router.use('/people', peopleRoute);
router.use('/repos', reposRoute);
router.use('/', orgsRoute);

module.exports = router;
