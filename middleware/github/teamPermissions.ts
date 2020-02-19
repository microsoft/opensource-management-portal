//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

import { ReposAppRequest } from "../../transitional";
import { Team } from "../../business/team";

const teamPermissionsCacheKeyName = 'teamPermissions';

export interface IRequestTeamPermissions {
  allowAdministration: boolean;
  maintainer: boolean;
  sudo: boolean;
}

export async function AddTeamPermissionsToRequest(req: ReposAppRequest, res, next) {
  if (req[teamPermissionsCacheKeyName]) {
    return next();
  }
  const login = req.individualContext.getGitHubIdentity().username;
  const idAsString = req.individualContext.getGitHubIdentity().id;
  const id = idAsString ? parseInt(idAsString, 10) : null;
  const organization = req.organization;
  const teamPermissions: IRequestTeamPermissions = {
    allowAdministration: false,
    maintainer: false,
    sudo: false,
  };
  req[teamPermissionsCacheKeyName] = teamPermissions;
  const isSudoer = await organization.isSudoer(login);
  const isPortalSudoer = await req.individualContext.isPortalAdministrator();

  // Indicate that the user is has sudo rights
  if (isSudoer === true || isPortalSudoer === true) {
    teamPermissions.sudo = true;
  }

  // Get the team maintainers
  const team2 = req['team2'] as Team;
  const maintainers = await team2.getMaintainers();

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
};
