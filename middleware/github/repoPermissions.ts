//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { ReposAppRequest } from '../../transitional';
import { Repository } from '../../business/repository';

const repoPermissionsCacheKeyName = 'repoPermissions';
const requestScopedRepositoryKeyName = 'repository';

export async function AddRepositoryPermissionsToRequest(req: ReposAppRequest, res, next) {
  if (req[repoPermissionsCacheKeyName]) {
    return next();
  }
  const login = req.individualContext.getGitHubIdentity().username;
  // const idAsString = req.individualContext.getGitHubIdentity().id;
  // const id = idAsString ? parseInt(idAsString, 10) : null;
  const organization = req.organization;
  const repository = req[requestScopedRepositoryKeyName] as Repository;
  const repoPermissions = {
    allowAdministration: false,
    admin: false,
    sudo: false,
  };
  req[repoPermissionsCacheKeyName] = repoPermissions;
  const isSudoer = await organization.isSudoer(login);
  const isPortalSudoer = await req.individualContext.isPortalAdministrator();
  // Indicate that the user is has sudo rights
  if (isSudoer === true || isPortalSudoer === true) {
    repoPermissions.sudo = true;
  }
  try {
    const collaborator = await repository.getCollaborator(login);
    if (collaborator && collaborator.permission === 'admin') {
      repoPermissions.admin = true;
    }
  } catch (getCollaboratorPermissionError) {
    console.dir(getCollaboratorPermissionError);
  }
  // Make a permission decision
  if (repoPermissions.admin || repoPermissions.sudo) {
    repoPermissions.allowAdministration = true;
  }
  return next();
};
