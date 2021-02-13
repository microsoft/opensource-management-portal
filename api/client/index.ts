//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import express from 'express';
import asyncHandler from 'express-async-handler';

import { jsonError } from '../../middleware/jsonError';
import { apiContextMiddleware } from '../../middleware/business/setContext';
import { requireAccessTokenClient, setIdentity } from '../../middleware/business/authentication';
import { AddLinkToRequest } from '../../middleware/links';
import { ReposAppRequest } from '../../transitional';

import RouteEmberClientNewRepo from './newRepo';

import ReleaseApprovalsRoute from './releaseApprovals';

import RouteServiceTree from './internal/serviceTree';
import RouteDirectory from './internal/directory';
import RouteOrganizations from './internal/organizations';
import RouteContext from './internal/context';
import RouteLinking from './internal/linking';
import RouteSession from './internal/session';
import RouteBanner from './internal/banner';
import RouteCrossOrganizationPeople from './internal/people';
import RouteCrossOrganizationRepos from './internal/repos';
import RouteCrossOrganizationTeams from './internal/teams';
import RouteCorporateRepoMetadata from './internal/corporateRepoMetadata';

const router = express.Router();

router.use((req: ReposAppRequest, res, next) => {
  if (req.isAuthenticated()) {
    return next();
  }
  return next(jsonError('The current session is not authenticated', 401));
});
router.use(asyncHandler(requireAccessTokenClient));
router.use(apiContextMiddleware);
router.use(setIdentity);
router.use(asyncHandler(AddLinkToRequest));

// --- new React client ---
router.use('/serviceTree', RouteServiceTree);
router.use('/banner', RouteBanner);
router.use('/directory', RouteDirectory);
router.use('/orgs', RouteOrganizations);
router.use('/context', RouteContext);
router.use('/link', RouteLinking);
router.use('/signout', RouteSession);
router.use('/corporateRepoMetadata', RouteCorporateRepoMetadata);
router.use('/people', RouteCrossOrganizationPeople);
router.use('/repos', RouteCrossOrganizationRepos);
router.use('/teams', RouteCrossOrganizationTeams);
// --- end of new React client work ---

router.use('/newRepo', RouteEmberClientNewRepo);
router.use('/releaseApprovals', ReleaseApprovalsRoute);

router.use((req, res, next) => {
  return next(jsonError('The resource or endpoint you are looking for is not there', 404));
});

export default router;
