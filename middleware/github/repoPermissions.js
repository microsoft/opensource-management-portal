//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

module.exports = function addRepoPermissionsToRequest(req, res, next) {
  if (req.repoPermissions) {
    return next();
  }
  const login = req.legacyUserContext.usernames.github;
  // const id = req.legacyUserContext.id.github ? parseInt(req.legacyUserContext.id.github, 10) : null;
  const organization = req.organization;
  const repository = req.repository;
  const repoPermissions = {
    allowAdministration: false,
    admin: false,
    sudo: false,
  };
  req.repoPermissions = repoPermissions;
  organization.isSudoer(login, (sudoCheckError, isSudoer) => {
    req.legacyUserContext.isPortalAdministrator((portalSudoError, isPortalSudoer) => {
      if (portalSudoError) {
        return next(portalSudoError);
      }
      // Indicate that the user is has sudo rights
      if (isSudoer === true || isPortalSudoer === true) {
        repoPermissions.sudo = true;
      }

      repository.getCollaborator(login, (error, collaborator) => {
        if (error) {
          return next(error);
        }

        if (collaborator && collaborator.permission === 'admin') {
          repoPermissions.admin = true;
        }

        // Make a permission decision
        if (repoPermissions.admin || repoPermissions.sudo) {
          repoPermissions.allowAdministration = true;
        }

        return next();
      });
    });
  });
};
