//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

import express from 'express';

import { ReposAppRequest, IReposError } from '../transitional';
import { IndividualContext } from '../user';
import { storeOriginalUrlAsVariable } from '../utils';
import { AuthorizeOnlyCorporateAdministrators } from '../middleware/business/corporateAdministrators';
const router = express.Router();

const orgsRoute = require('./orgs');
const orgAdmin = require('./orgAdmin');
const peopleRoute = require('./people');
const setupRoute = require('./administration');
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
router.use('/organization', orgAdmin);
router.use('/people', peopleRoute);
router.use('/repos', reposRoute);
router.use('/administration', AuthorizeOnlyCorporateAdministrators, setupRoute);
router.use('/', orgsRoute);

module.exports = router;
