//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { NextFunction, Response } from 'express';

import { Repository } from '../../business/repository';
import type { ReposAppRequest } from '../../interfaces/web';
import { CreateError } from '../../lib/transitional';

export type RequestWithRepo = ReposAppRequest & {
  repository: Repository;
};

export async function apiMiddlewareRepositoriesToRepository(
  req: RequestWithRepo,
  res: Response,
  next: NextFunction
) {
  const { organization } = req;
  if (!organization) {
    return next(CreateError.InvalidParameters('No organization instance available'));
  }

  const { repoName } = req.params;
  if (!repoName) {
    return next(CreateError.InvalidParameters('No repository name provided'));
  }

  // does not confirm the name
  req.repository = organization.repository(repoName);
  return next();
}
