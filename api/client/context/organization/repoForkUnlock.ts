//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { Router } from 'express';
import asyncHandler from 'express-async-handler';

import { jsonError } from '../../../../middleware';
import { getRepositoryMetadataProvider, ReposAppRequest } from '../../../../interfaces';
import { Organization } from '../../../../business';
import {
  getContextualRepository,
  getContextualRepositoryPermissions,
} from '../../../../middleware/github/repoPermissions';
import { IndividualContext } from '../../../../business/user';
import { ErrorHelper, getProviders } from '../../../../transitional';
import NewRepositoryLockdownSystem from '../../../../features/newRepositories/newRepositoryLockdown';

const router: Router = Router();

router.use(
  asyncHandler(async (req: ReposAppRequest, res, next) => {
    const organization = req.organization as Organization;
    if (!organization.isNewRepositoryLockdownSystemEnabled()) {
      return next(jsonError('This endpoint is not available as configured for the organization', 400));
    }
    const activeContext = (req.individualContext || req.apiContext) as IndividualContext;
    const isOrgSudoer = await organization.isSudoer(
      activeContext.getGitHubIdentity().username,
      activeContext.link
    );
    if (!isOrgSudoer) {
      const isPortalSudoer = await activeContext.isPortalAdministrator();
      if (!isPortalSudoer) {
        return next(jsonError('You do not have sudo permission for this organization', 403));
      }
    }
    return next();
  })
);

router.post(
  '/approve',
  asyncHandler(async (req: ReposAppRequest, res, next) => {
    const { operations } = getProviders(req);
    const repository = getContextualRepository(req);
    const repositoryMetadataProvider = getRepositoryMetadataProvider(operations);
    const organization = repository.organization;
    const lockdownSystem = new NewRepositoryLockdownSystem({
      operations,
      organization,
      repository,
      repositoryMetadataProvider,
    });
    try {
      await lockdownSystem.removeAdministrativeLock();
      return res.json({
        message: `Unlocked the ${repository.name} repo in the ${organization.name} org`,
        unlocked: true,
      });
    } catch (error) {
      return next(
        jsonError(
          `Problem while approving the administrative lock: ${error}`,
          ErrorHelper.GetStatus(error) || 500
        )
      );
    }
  })
);

router.use('*', (req, res, next) => {
  return next(jsonError(`no API or ${req.method} function available for repo fork unlock`, 404));
});

export default router;
