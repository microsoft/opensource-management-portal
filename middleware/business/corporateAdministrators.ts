//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

// This route does not use GitHub as a source of truth but instead falls back to
// corporate assigned usernames or security group membership.

import { NextFunction, Response } from 'express';

import { ReposAppRequest } from '../../interfaces';
import { getProviders } from '../../lib/transitional';
import { IndividualContext } from '../../business/user';
import { wrapError } from '../../lib/utils';
import { jsonError } from '../jsonError';

export interface IReposAppRequestWithSystemAdministration extends ReposAppRequest {
  isSystemAdministrator: boolean;
}

function denyRoute(next: NextFunction, isApi: boolean) {
  if (isApi) {
    return next(jsonError('This API is unavailable for you', 403));
  }
  return next(
    wrapError(
      null,
      "These aren't the droids you are looking for. You do not have permission to be here.",
      true
    )
  );
}

export async function AuthorizeOnlyCorporateAdministrators(
  req: ReposAppRequest,
  res: Response,
  next: NextFunction
) {
  const { operations } = getProviders(req);
  const activeContext = (req.individualContext || req.apiContext) as IndividualContext;
  const corporateId = activeContext.corporateIdentity?.id;
  const corporateUsername = activeContext.corporateIdentity?.username;
  if (await operations.isSystemAdministrator(corporateId, corporateUsername)) {
    return next();
  }
  return denyRoute(next, !!req.apiContext);
}

export async function checkIsCorporateAdministrator(
  req: IReposAppRequestWithSystemAdministration,
  res: Response,
  next: NextFunction
) {
  await getIsCorporateAdministrator(req);
  return next();
}

export async function getIsCorporateAdministrator(
  req: IReposAppRequestWithSystemAdministration | ReposAppRequest
) {
  const request = req as IReposAppRequestWithSystemAdministration;
  if (request.isSystemAdministrator !== undefined) {
    return request.isSystemAdministrator;
  }
  const { operations } = getProviders(req);
  const activeContext = (req.individualContext || req.apiContext) as IndividualContext;
  const corporateId = activeContext.corporateIdentity?.id;
  const corporateUsername = activeContext.corporateIdentity?.username;
  request.isSystemAdministrator = await operations.isSystemAdministrator(corporateId, corporateUsername);
  return request.isSystemAdministrator;
}
