//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { NextFunction, Response, Router } from 'express';
import asyncHandler from 'express-async-handler';

import { jsonError } from '../../../middleware';
import { CreateError, ErrorHelper, getProviders } from '../../../lib/transitional';
import { IndividualContext } from '../../../business/user';
import NewRepositoryLockdownSystem from '../../../business/features/newRepositories/newRepositoryLockdown';
import {
  AddRepositoryPermissionsToRequest,
  getContextualRepositoryPermissions,
} from '../../../middleware/github/repoPermissions';
import getCompanySpecificDeployment from '../../../middleware/companySpecificDeployment';

import RouteRepoPermissions from './repoPermissions';
import {
  LocalApiRepoAction,
  getRepositoryMetadataProvider,
  NoCacheNoBackground,
  GitHubRepositoryVisibility,
} from '../../../interfaces';
import { RequestWithRepo } from '../../../middleware/business/repository';

enum RepositoryChangeAction {
  Archive,
  UnArchive,
  Privatize,
}

const router: Router = Router();

const deployment = getCompanySpecificDeployment();
deployment?.routes?.api?.organization?.repo && deployment?.routes?.api?.organization?.repo(router);

router.use('/permissions', RouteRepoPermissions);

router.get(
  '/',
  asyncHandler(async (req: RequestWithRepo, res: Response, next: NextFunction) => {
    const { repository } = req;
    try {
      await repository.getDetails({ backgroundRefresh: false });
      const clone = Object.assign({}, repository.getEntity());
      delete (clone as any).temp_clone_token; // never share this back
      delete (clone as any).cost;

      return res.json(repository.getEntity()) as unknown as void;
    } catch (repoError) {
      if (ErrorHelper.IsNotFound(repoError)) {
        // // Attempt fallback by ID (?)
      }
      return next(jsonError(repoError));
    }
  })
);

router.get(
  '/exists',
  asyncHandler(async (req: RequestWithRepo, res: Response, next: NextFunction) => {
    let exists = false;
    let name: string = undefined;
    const { repository } = req;
    try {
      const originalName = repository.name;
      await repository.getDetails();
      if (repository && repository.name) {
        name = repository.getEntity().name as string;
        if (name.toLowerCase() !== originalName.toLowerCase()) {
          // A renamed repository will return the new name here
          exists = false;
        } else {
          exists = true;
        }
      }
    } catch (repoError) {}
    return res.json({ exists, name }) as unknown as void;
  })
);

router.get(
  '/archived',
  asyncHandler(async (req: RequestWithRepo, res: Response, next: NextFunction) => {
    const { repository } = req;
    try {
      await repository.getDetails();
      const data = {
        archivedAt: null,
      };
      if (repository?.archived) {
        const archivedAt = await repository.getArchivedAt();
        if (archivedAt) {
          data.archivedAt = archivedAt.toISOString();
        }
      }
      return res.json(data) as unknown as void;
    } catch (error) {
      return next(error);
    }
  })
);
router.post(
  '/privatize',
  asyncHandler(AddRepositoryPermissionsToRequest),
  asyncHandler(RepositoryStateChangeHandler.bind(null, RepositoryChangeAction.Privatize))
);

router.post(
  '/archive',
  asyncHandler(AddRepositoryPermissionsToRequest),
  asyncHandler(RepositoryStateChangeHandler.bind(null, RepositoryChangeAction.Archive))
);

router.post(
  '/unarchive',
  asyncHandler(AddRepositoryPermissionsToRequest),
  asyncHandler(RepositoryStateChangeHandler.bind(null, RepositoryChangeAction.UnArchive))
);

async function RepositoryStateChangeHandler(
  action: RepositoryChangeAction,
  req: RequestWithRepo,
  res: Response,
  next: NextFunction
) {
  const activeContext = (req.individualContext || req.apiContext) as IndividualContext;
  const providers = getProviders(req);
  const { insights } = providers;
  const repoPermissions = getContextualRepositoryPermissions(req);
  let phrase: string = null;
  let insightsPrefix: string = null;
  let localAction: LocalApiRepoAction = null;
  switch (action) {
    case RepositoryChangeAction.Archive:
      phrase = 'archive';
      insightsPrefix = 'ArchiveRepo';
      localAction = LocalApiRepoAction.Archive;
      break;
    case RepositoryChangeAction.UnArchive:
      phrase = 'unarchive';
      insightsPrefix = 'UnArchiveRepo';
      localAction = LocalApiRepoAction.UnArchive;
      break;
    case RepositoryChangeAction.Privatize:
      phrase = 'privatize';
      insightsPrefix = 'PrivatizeRepo';
      localAction = LocalApiRepoAction.Privatize;
      break;
    default:
      return next(jsonError('Invalid action', 400));
  }
  const completedPhrase = `${phrase}d`;
  if (!repoPermissions.allowAdministration) {
    return next(jsonError(`You do not have permission to ${phrase} this repo`, 403));
  }
  const { repository } = req;
  try {
    insights?.trackEvent({
      name: `${insightsPrefix}Started`,
      properties: {
        requestedById: activeContext.link.corporateId,
        repoName: repository.name,
        orgName: repository.organization.name,
        repoId: repository.id ? String(repository.id) : 'unknown',
      },
    });
    const currentRepositoryState = deployment?.features?.repositoryActions?.getCurrentRepositoryState
      ? await deployment.features.repositoryActions.getCurrentRepositoryState(providers, repository)
      : null;
    switch (action) {
      case RepositoryChangeAction.Archive: {
        await repository.archive();
        break;
      }
      case RepositoryChangeAction.UnArchive: {
        await repository.unarchive();
        break;
      }
      case RepositoryChangeAction.Privatize: {
        await repository.update({
          visibility: GitHubRepositoryVisibility.Private,
        });
        break;
      }
      default: {
        return next(CreateError.InvalidParameters('Invalid action'));
      }
    }
    if (deployment?.features?.repositoryActions?.sendActionReceipt) {
      deployment.features.repositoryActions
        .sendActionReceipt(providers, activeContext, repository, localAction, currentRepositoryState)
        .then((ok) => {})
        .catch(() => {});
    }
    insights?.trackMetric({
      name: `${insightsPrefix}s`,
      value: 1,
    });
    insights?.trackEvent({
      name: `${insightsPrefix}Success`,
      properties: {
        requestedById: activeContext.link.corporateId,
        repoName: repository.name,
        orgName: repository.organization.name,
        repoId: repository.id ? String(repository.id) : 'unknown',
      },
    });
    // Update the details without background cache so the next fetch is fresh
    try {
      await repository.getDetails(NoCacheNoBackground);
    } catch (ignore) {
      insights?.trackException({ exception: ignore });
    }
    return res.json({
      message: `You ${completedPhrase}: ${repository.full_name}`,
    });
  } catch (error) {
    insights?.trackException({ exception: error });
    insights?.trackEvent({
      name: `${insightsPrefix}Failed`,
      properties: {
        requestedById: activeContext.link.corporateId,
        repoName: repository.name,
        orgName: repository.organization.name,
        repoId: repository.id ? String(repository.id) : 'unknown',
      },
    });
    return next(jsonError(error));
  }
}

router.delete(
  '/',
  asyncHandler(AddRepositoryPermissionsToRequest),
  asyncHandler(async function (req: RequestWithRepo, res: Response, next: NextFunction) {
    // NOTE: duplicated code from /routes/org/repos.ts
    const providers = getProviders(req);
    const { insights } = providers;
    const insightsPrefix = 'DeleteRepo';
    const activeContext = (req.individualContext || req.apiContext) as IndividualContext;
    const { organization, repository } = req;
    const repoPermissions = getContextualRepositoryPermissions(req);
    if (repoPermissions.allowAdministration) {
      try {
        insights?.trackEvent({
          name: `${insightsPrefix}Started`,
          properties: {
            requestedById: activeContext.link.corporateId,
            repoName: repository.name,
            orgName: repository.organization.name,
            repoId: repository.id ? String(repository.id) : 'unknown',
          },
        });
        const currentRepositoryState = deployment?.features?.repositoryActions?.getCurrentRepositoryState
          ? await deployment.features.repositoryActions.getCurrentRepositoryState(providers, repository)
          : null;
        await repository.delete();
        if (deployment?.features?.repositoryActions?.sendActionReceipt) {
          deployment.features.repositoryActions
            .sendActionReceipt(
              providers,
              activeContext,
              repository,
              LocalApiRepoAction.Delete,
              currentRepositoryState
            )
            .then((ok) => {})
            .catch(() => {});
        }
        insights?.trackMetric({
          name: `${insightsPrefix}s`,
          value: 1,
        });
        insights?.trackEvent({
          name: `${insightsPrefix}Success`,
          properties: {
            requestedById: activeContext.link.corporateId,
            repoName: repository.name,
            orgName: repository.organization.name,
            repoId: repository.id ? String(repository.id) : 'unknown',
          },
        });
        return res.json({
          message: `You deleted: ${repository.full_name}`,
        }) as unknown as void;
      } catch (error) {
        insights?.trackException({ exception: error });
        insights?.trackEvent({
          name: `${insightsPrefix}Failed`,
          properties: {
            requestedById: activeContext.link.corporateId,
            repoName: repository.name,
            orgName: repository.organization.name,
            repoId: repository.id ? String(repository.id) : 'unknown',
          },
        });
        return next(jsonError(error));
      }
    }
    if (!organization.isNewRepositoryLockdownSystemEnabled) {
      return next(jsonError('This endpoint is not available as configured in this app.', 400));
    }
    const daysAfterCreateToAllowSelfDelete = 21; // could be a config setting if anyone cares
    try {
      // make sure ID is known
      if (await repository.isDeleted()) {
        return next(jsonError('The repository has already been deleted', 404));
      }
      const metadata = await repository.getRepositoryMetadata();
      await NewRepositoryLockdownSystem.Statics.ValidateUserCanSelfDeleteRepository(
        repository,
        metadata,
        activeContext,
        daysAfterCreateToAllowSelfDelete
      );
    } catch (noExistingMetadata) {
      if (noExistingMetadata.status === 404) {
        return next(
          jsonError(
            'This repository does not have any metadata available regarding who can setup it up. No further actions available.',
            400
          )
        );
      }
      return next(jsonError(noExistingMetadata, 404));
    }
    const { operations } = getProviders(req);
    const repositoryMetadataProvider = getRepositoryMetadataProvider(operations);
    const lockdownSystem = new NewRepositoryLockdownSystem({
      insights,
      operations,
      organization,
      repository,
      repositoryMetadataProvider,
    });
    await lockdownSystem.deleteLockedRepository(
      false /* delete for any reason */,
      true /* deleted by the original user instead of ops */
    );
    return res.json({
      message: `You deleted your repo, ${repository.full_name}.`,
    }) as unknown as void;
  })
);

router.use('*', (req, res: Response, next: NextFunction) => {
  console.warn(req.baseUrl);
  return next(jsonError('no API or function available within this specific repo', 404));
});

export default router;
