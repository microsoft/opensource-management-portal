import { ReposAppRequest } from "../../transitional";

//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

const repoPermissionsCacheKeyName = 'repoPermissions';

const requestScopedRepositoryKeyName = 'repository';

module.exports = function addRepoPermissionsToRequest(req: ReposAppRequest, res, next) {
  if (req[repoPermissionsCacheKeyName]) {
    return next();
  }
  const login = req.individualContext.getGitHubIdentity().username;
  // const idAsString = req.individualContext.getGitHubIdentity().id;
  // const id = idAsString ? parseInt(idAsString, 10) : null;
  const organization = req.organization;
  const repository = req[requestScopedRepositoryKeyName];
  const repoPermissions = {
    allowAdministration: false,
    admin: false,
    sudo: false,
  };
  req[repoPermissionsCacheKeyName] = repoPermissions;
  organization.isSudoer(login, (sudoCheckError, isSudoer) => {
    req.individualContext.isPortalAdministrator().then(isPortalSudoer => {
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
    }).catch(portalSudoError => {
      return next(portalSudoError);
    });
  });
};
