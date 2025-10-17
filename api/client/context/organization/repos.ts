//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { NextFunction, Response, Router } from 'express';

import { Repository } from '../../../../business/index.js';
import { jsonError } from '../../../../middleware/index.js';
import { setContextualRepository } from '../../../../middleware/github/repoPermissions.js';

import {
  OrganizationMembershipState,
  ReposAppRequest,
  VoidedExpressRoute,
} from '../../../../interfaces/index.js';
import { IndividualContext } from '../../../../business/user/index.js';
import { createRepositoryFromClient, setRepositoryCreateSourceThenNext } from '../../newOrgRepo.js';

import routeContextualRepo from './repo.js';

const router: Router = Router();

async function validateActiveMembership(req: ReposAppRequest, res: Response, next: NextFunction) {
  const { organization } = req;
  const activeContext = (req.individualContext || req.apiContext) as IndividualContext;
  if (!activeContext.link) {
    return next(
      jsonError('You must be linked and a member of the organization to create and manage repos', 400)
    );
  }
  const membership = await organization.getOperationalMembership(activeContext.getGitHubIdentity().username);
  if (!membership || membership.state !== OrganizationMembershipState.Active) {
    return next(jsonError('You must be a member of the organization to create and manage repos', 400));
  }
  req['knownRequesterMailAddress'] = activeContext.link.corporateMailAddress;
  return next();
}

router.post(
  '/',
  validateActiveMembership,
  setRepositoryCreateSourceThenNext.bind('client'),
  createRepositoryFromClient as VoidedExpressRoute
);

router.use('/:repoName', async (req: ReposAppRequest, res: Response, next: NextFunction) => {
  const { organization } = req;
  const { repoName } = req.params;
  let repository: Repository = null;
  repository = organization.repository(repoName);
  setContextualRepository(req, repository);
  return next();
});

router.use('/:repoName', routeContextualRepo);

router.use('/*splat', (req, res: Response, next: NextFunction) => {
  return next(jsonError('no API or function available for repos', 404));
});

export default router;
