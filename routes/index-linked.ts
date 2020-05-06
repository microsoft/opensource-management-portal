//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import express from 'express';
import asyncHandler from 'express-async-handler';
const router = express.Router();

import { ReposAppRequest, IProviders, CreateError } from '../transitional';
import { IndividualContext } from '../user';
import { storeOriginalUrlAsVariable } from '../utils';
import { AuthorizeOnlyCorporateAdministrators } from '../middleware/business/corporateAdministrators';

import unlinkRoute from './unlink';
import { Organization } from '../business/organization';
import { Repository } from '../business/repository';

const orgsRoute = require('./orgs');
const orgAdmin = require('./orgAdmin');
const peopleRoute = require('./people');
const setupRoute = require('./administration');
const reposRoute = require('./repos');
const teamsRoute = require('./teams');
const undoRoute = require('./undo');
const contributionsRoute = require('./contributions');

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
router.use('/undo', undoRoute);
router.use('/contributions', contributionsRoute);
router.use('/administration', AuthorizeOnlyCorporateAdministrators, setupRoute);

router.use('/https?*github.com/:org/:repo', asyncHandler(async (req, res, next) => {
  // Helper method to allow pasting a GitHub URL into the app to go to a repo
  const { org, repo } = req.params;
  const { operations } = req.app.settings.providers as IProviders;
  if (org && repo) {
    let organization: Organization = null;
    try {
      organization = operations.getOrganization(org);
    } catch (error) {
      return next(CreateError.InvalidParameters(`Organization ${org} not managed by this system`));
    }
    let repository: Repository = null;
    try {
      repository = organization.repository(repo);
      await repository.getDetails();
    }
    catch (error) {
      return next(CreateError.NotFound(`The repository ${org}/${repo} no longer exists.`));
    }
    return res.redirect(repository.baseUrl);
  }
  return next();
}));

router.use('/', orgsRoute);

export default router;
