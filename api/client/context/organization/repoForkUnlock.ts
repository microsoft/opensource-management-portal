//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { NextFunction, Response, Router } from 'express';

import { jsonError } from '../../../../middleware/index.js';
import { getRepositoryMetadataProvider, ReposAppRequest } from '../../../../interfaces/index.js';
import { Organization } from '../../../../business/index.js';
import { getContextualRepository } from '../../../../middleware/github/repoPermissions.js';
import { IndividualContext } from '../../../../business/user/index.js';
import { ErrorHelper, getProviders } from '../../../../lib/transitional.js';
import NewRepositoryLockdownSystem from '../../../../business/features/newRepositories/newRepositoryLockdown.js';

const router: Router = Router();

router.use(async (req: ReposAppRequest, res: Response, next: NextFunction) => {
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
});

router.post('/approve', async (req: ReposAppRequest, res: Response, next: NextFunction) => {
  const { insights, operations } = getProviders(req);
  const repository = getContextualRepository(req);
  const repositoryMetadataProvider = getRepositoryMetadataProvider(operations);
  const organization = repository.organization;
  const lockdownSystem = new NewRepositoryLockdownSystem({
    insights,
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
    }) as unknown as void;
  } catch (error) {
    return next(
      jsonError(
        `Problem while approving the administrative lock: ${error}`,
        ErrorHelper.GetStatus(error) || 500
      )
    );
  }
});

router.use('/*splat', (req, res: Response, next: NextFunction) => {
  return next(jsonError(`no API or ${req.method} function available for repo fork unlock`, 404));
});

export default router;
