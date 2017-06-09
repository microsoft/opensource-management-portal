//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

module.exports = function addTeamPermissionsToRequest(req, res, next) {
  if (req.teamPermissions) {
    return next();
  }
  const login = req.legacyUserContext.usernames.github;
  const id = req.legacyUserContext.id.github ? parseInt(req.legacyUserContext.id.github, 10) : null;
  const organization = req.organization;
  const teamPermissions = {
    allowAdministration: false,
    maintainer: false,
    sudo: false,
  };
  req.teamPermissions = teamPermissions;
  organization.isSudoer(login, (sudoCheckError, isSudoer) => {
    if (sudoCheckError) {
      return next(sudoCheckError);
    }
    req.legacyUserContext.isPortalAdministrator((portalSudoError, isPortalSudoer) => {
      if (portalSudoError) {
        return next(portalSudoError);
      }
      // Indicate that the user is has sudo rights
      if (isSudoer === true || isPortalSudoer === true) {
        teamPermissions.sudo = true;
      }

      // Get the team maintainers
      const team2 = req.team2;
      team2.getMaintainers((getMaintainersError, maintainers) => {
        if (getMaintainersError) {
          return next(getMaintainersError);
        }

        // +MIDDLEWARE: providing this later to speed up getting this data
        req.teamMaintainers = maintainers;

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
    });
  });
};
