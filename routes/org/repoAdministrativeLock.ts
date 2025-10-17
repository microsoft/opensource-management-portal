//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { NextFunction, Response, Router } from 'express';
const router: Router = Router();

import { getProviders } from '../../lib/transitional.js';
import { Repository } from '../../business/repository.js';
import { RepositoryMetadataEntity } from '../../business/entities/repositoryMetadata/repositoryMetadata.js';
import { Organization } from '../../business/organization.js';
import NewRepositoryLockdownSystem from '../../business/features/newRepositories/newRepositoryLockdown.js';
import { getRepositoryMetadataProvider, ReposAppRequest, UserAlertType } from '../../interfaces/index.js';

router.use('/', async (req: ReposAppRequest, res: Response, next: NextFunction) => {
  const organization = req.organization as Organization;
  if (!organization.isNewRepositoryLockdownSystemEnabled()) {
    return next(new Error('This endpoint is not available as configured'));
  }
  return next();
});

router.use('/', async (req: ReposAppRequest, res: Response, next: NextFunction) => {
  const individualContext = req.individualContext;
  const isPortalAdministrator = await individualContext.isPortalAdministrator();
  if (!isPortalAdministrator) {
    return next(new Error('Only a portal administrator can access this endpoint'));
  }
  const repository = req['repository'] as Repository;
  // const metadata = await repository.getRepositoryMetadata();
  // req['repositoryMetadata'] = metadata;
  return next();
});

router.get('/', async (req: ReposAppRequest, res: Response, next: NextFunction) => {
  const repository = req['repository'] as Repository;
  const repositoryMetadata = req['repositoryMetadata'] as RepositoryMetadataEntity;
  return renderPage(req, repositoryMetadata, repository);
});

router.post('/', async (req: ReposAppRequest, res: Response, next: NextFunction) => {
  const providers = getProviders(req);
  const { insights, operations } = providers;
  const repository = req['repository'] as Repository;
  const entity = repository.getEntity();
  if (!entity.parent) {
    return next(new Error('This repository was not forked. No actions available.'));
  }
  const repositoryMetadata = req['repositoryMetadata'] as RepositoryMetadataEntity;
  const actionDelete = req.body['delete-fork'];
  const actionUnlock = req.body['remove-administrative-lock'];
  if (!actionDelete && !actionUnlock) {
    return next(new Error('No action selected'));
  }
  const repositoryMetadataProvider = getRepositoryMetadataProvider(operations);
  const organization = repository.organization;
  const lockdownSystem = new NewRepositoryLockdownSystem({
    insights,
    operations,
    organization,
    repository,
    repositoryMetadataProvider,
  });
  if (actionUnlock) {
    await lockdownSystem.removeAdministrativeLock();
    req.individualContext.webContext.saveUserAlert('Repo approved', 'Approved', UserAlertType.Success);
  }
  if (actionDelete) {
    await lockdownSystem.deleteLockedRepository(
      true /* only if admin locked now */,
      false /* not deleted by the user */
    );
    req.individualContext.webContext.saveUserAlert(
      'Repo delete action queued',
      'Delete',
      UserAlertType.Success
    );
  }
  return renderPage(req, repositoryMetadata, repository);
});

function renderPage(
  req: ReposAppRequest,
  repositoryMetadata: RepositoryMetadataEntity,
  repository: Repository
) {
  return req.individualContext.webContext.render({
    view: 'repos/administrativeLock',
    title: 'Administrative lock settings',
    state: {
      repositoryMetadata,
      repository,
      organization: repository.organization,
      repositoryEntity: repository.getEntity(),
    },
  });
}

export default router;
