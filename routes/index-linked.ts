//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

import express = require('express');
import { ReposAppRequest, IReposError } from '../transitional';
import { IndividualContext } from '../business/context2';
import { storeOriginalUrlAsVariable } from '../utils';
const router = express.Router();

const approvalsSystem = require('./approvals');
const orgsRoute = require('./orgs');
const orgAdmin = require('./orgAdmin');
const peopleRoute = require('./people');
const reposRoute = require('./repos');
const teamsRoute = require('./teams');
const unlinkRoute = require('./unlink');

//-----------------------------------------------------------------------------
//-----------------------------------------------------------------------------
// SECURITY ROUTE MARKER:
// Below this next call, all routes will require an active link to exist for
// the authenticated GitHub user.
//-----------------------------------------------------------------------------
//-----------------------------------------------------------------------------
router.use(function (req: ReposAppRequest, res, next) {
  const individualContext = req.individualContext as IndividualContext;
  const config = req.app.settings.runtimeConfig;
  const link = individualContext.link;

  if (link && link.thirdPartyId) {
    return next();
  }

  storeOriginalUrlAsVariable(req, res, 'beforeLinkReferrer', '/', 'no linked github username');
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
