//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

module.exports = function addSystemWidePermissionsToRequest(req, res, next) {
  // Only compute once per request
  if (req.systemWidePermissions) {
    return next();
  }
  const systemWidePermissions = {
    allowAdministration: false,
    sudo: false,
  };
  req.systemWidePermissions = systemWidePermissions;
  req.legacyUserContext.isPortalAdministrator((portalSudoError, isPortalSudoer) => {
    if (isPortalSudoer) {
      systemWidePermissions.sudo = true;
      systemWidePermissions.allowAdministration = true;
    }

    return next();
  });
};
