//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { NextFunction, Response } from 'express';

import { ReposAppRequest } from '../../interfaces/index.js';

const requestCachedKeyName = 'systemWidePermissions';

export default function addSystemWidePermissionsToRequest(
  req: ReposAppRequest,
  res: Response,
  next: NextFunction
) {
  // Only compute once per request
  if (req[requestCachedKeyName]) {
    return next();
  }
  const systemWidePermissions = {
    allowAdministration: false,
    sudo: false,
  };
  req[requestCachedKeyName] = systemWidePermissions;
  req.individualContext
    .isPortalAdministrator()
    .then((isPortalSudoer) => {
      if (isPortalSudoer) {
        systemWidePermissions.sudo = true;
        systemWidePermissions.allowAdministration = true;
      }
      return next();
    })
    .catch((portalSudoErrorIgnored) => {
      console.warn('Ignored portalSudoErrorIgnored error');
      console.warn(portalSudoErrorIgnored);

      return next();
    });
}
