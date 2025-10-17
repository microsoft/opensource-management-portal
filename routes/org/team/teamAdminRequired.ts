//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { NextFunction, Response } from 'express';

import { IReposError } from '../../../interfaces/index.js';

export default function middlewareTeamAdminRequired(req, res: Response, next: NextFunction) {
  const teamPermissions = req.teamPermissions;
  if (!teamPermissions) {
    return next(new Error('No team permissions information available'));
  }

  if (teamPermissions.allowAdministration === true) {
    return next();
  }

  const err: IReposError = new Error('You do not have permission to administer this team');
  err.status = 403;
  return next(err);
}
