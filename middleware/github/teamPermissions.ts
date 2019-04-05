//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

import { ReposAppRequest } from "../../transitional";

const teamPermissionsCacheKeyName = 'teamPermissions';

module.exports = function addTeamPermissionsToRequest(req: ReposAppRequest, res, next) {
  if (req[teamPermissionsCacheKeyName]) {
    return next();
  }
  const login = req.individualContext.getGitHubIdentity().username;
  const idAsString = req.individualContext.getGitHubIdentity().id;
  const id = idAsString ? parseInt(idAsString, 10) : null;
  const organization = req.organization;
  const teamPermissions = {
    allowAdministration: false,
    maintainer: false,
    sudo: false,
  };
  req[teamPermissionsCacheKeyName] = teamPermissions;
  organization.isSudoer(login, (sudoCheckError, isSudoer) => {
    if (sudoCheckError) {
      return next(sudoCheckError);
    }
    req.individualContext.isPortalAdministrator().then(isPortalSudoer => {
      // Indicate that the user is has sudo rights
      if (isSudoer === true || isPortalSudoer === true) {
        teamPermissions.sudo = true;
      }

      // Get the team maintainers
      const team2 = req['team2'];
      team2.getMaintainers((getMaintainersError, maintainers) => {
        if (getMaintainersError) {
          return next(getMaintainersError);
        }

        // +MIDDLEWARE: providing this later to speed up getting this data
        req['teamMaintainers'] = maintainers;

        for (let i = 0; i < maintainers.length; i++) {
          if (maintainers[i].id === id) {
            teamPermissions.maintainer = true;
            break;
          }
        }

        // Make a permission decision
        if (teamPermissions.maintainer || teamPermissions.sudo) {
          teamPermissions.allowAdministration = true;
        }
        return next();
      });
    }).catch(portalSudoError => {
      return next(portalSudoError);
    });
  });
};
