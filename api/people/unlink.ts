//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { NextFunction, Response, Router } from 'express';

import { ICorporateLink, ReposApiRequest, UnlinkPurpose } from '../../interfaces/index.js';
import { jsonError } from '../../middleware/index.js';
import { CreateError, getProviders } from '../../lib/transitional.js';

const router: Router = Router();

interface ILinksApiRequestWithUnlink extends ReposApiRequest {
  unlink?: ICorporateLink;
}

router.use(function (req: ILinksApiRequestWithUnlink, res: Response, next: NextFunction) {
  const token = req.apiKeyToken;
  if (!token.hasScope) {
    return next(CreateError.NotAuthorized('The key is not authorized for specific APIs'));
  }
  if (!token.hasScope('unlink')) {
    return next(CreateError.NotAuthorized('The key is not authorized to use the unlink API'));
  }
  return next();
});

router.use('/github/id/:id', async (req: ILinksApiRequestWithUnlink, res: Response, next: NextFunction) => {
  const { linkProvider } = getProviders(req);
  const id = req.params.id;
  try {
    const link = await linkProvider.getByThirdPartyId(id);
    if (!link) {
      throw new Error(`Could not locate a link for GitHub user ID ${id}`);
    }
    req.unlink = link;
    return next();
  } catch (error) {
    return next(jsonError(error));
  }
});

router.use('/*splat', (req: ILinksApiRequestWithUnlink, res: Response, next: NextFunction) => {
  return next(req.unlink ? undefined : jsonError('No link available for operation', 404));
});

router.delete('/*splat', (req: ILinksApiRequestWithUnlink, res: Response, next: NextFunction) => {
  const { config, operations } = getProviders(req);
  const link = req.unlink;
  let purpose: UnlinkPurpose = null;
  try {
    purpose = apiUnlinkPurposeToEnum((req.headers['unlink-purpose'] || 'termination') as string);
  } catch (purposeError) {
    return next(jsonError(purposeError, 400));
  }
  const unlinkWithoutDrops = config?.debug?.unlinkWithoutDrops;
  const options = { purpose, unlinkWithoutDrops };
  return operations
    .terminateLinkAndMemberships(link.thirdPartyId, options)
    .then((results) => {
      res.json({
        messages: Array.isArray(results) ? (results as any as string[]).reverse() : results,
      });
    })
    .catch((problem) => {
      return next(jsonError(problem, 500));
    });
});

function apiUnlinkPurposeToEnum(purpose: string): UnlinkPurpose {
  switch (purpose) {
    case 'operations':
      throw new Error('The unlink purpose "operations" is not supported by API');
    case 'termination':
      return UnlinkPurpose.Termination;
    case 'self':
      throw new Error('The unlink purpose "self" is not supported by API');
    default:
      return UnlinkPurpose.Unknown;
  }
}

export default router;
