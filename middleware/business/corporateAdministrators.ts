//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

// This route does not use GitHub as a source of truth but instead falls back to
// corporate assigned usernames or security group membership.

import { ReposAppRequest } from '../../interfaces';
import { getProviders } from '../../transitional';
import { IndividualContext } from '../../business/user';
import { wrapError } from '../../utils';
import { jsonError } from '../jsonError';

export interface IReposAppRequestWithSystemAdministration extends ReposAppRequest {
  isSystemAdministrator: boolean;
}

function denyRoute(next, isApi: boolean) {
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

export async function AuthorizeOnlyCorporateAdministrators(req: ReposAppRequest, res, next) {
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
  res,
  next
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
