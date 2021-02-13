//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { IProviders, ReposAppRequest } from '../../transitional';
import { Repository } from '../../business/repository';
import { IndividualContext } from '../../user';
import { GitHubCollaboratorPermissionLevel } from '../../business/repositoryPermission';
import { ICorporateProviders } from '../../microsoft';

const repoPermissionsCacheKeyName = 'repoPermissions';
const requestScopedRepositoryKeyName = 'repository';

export interface IContextualRepositoryPermissions {
  allowAdministration: boolean;
  admin: boolean;
  write: boolean;
  read: boolean;
  sudo: boolean;
  isLinked: boolean;
  isMaintainer: boolean; // CONSIDER: refactor Microsoft-specific code out
  allowJit: boolean; // CONSIDER: refactor Microsoft-specific code out
}

export function getContextualRepositoryPermissions(req: ReposAppRequest) {
  if (!req[repoPermissionsCacheKeyName]) {
    throw new Error('No permissions available');
  }
  return req[repoPermissionsCacheKeyName] as IContextualRepositoryPermissions;
}

export function setContextualRepository(req: ReposAppRequest, repository: Repository) {
  req[requestScopedRepositoryKeyName] = repository;
}

export function getContextualRepository(req: ReposAppRequest) {
  return req[requestScopedRepositoryKeyName] as Repository;
}

export async function getComputedRepositoryPermissions(provs: IProviders, activeContext: IndividualContext, repository: Repository) {
  const providers = provs as ICorporateProviders;
  const repoPermissions: IContextualRepositoryPermissions = {
    isLinked: false,
    allowAdministration: false,
    admin: false,
    sudo: false,
    write: false,
    read: false,
    isMaintainer: false,
    allowJit: false,
  };
  if (!activeContext.link) {
    return repoPermissions;
  }
  repoPermissions.isLinked = true;
  const login = activeContext.getGitHubIdentity().username;
  // const idAsString = req.individualContext.getGitHubIdentity().id;
  // const id = idAsString ? parseInt(idAsString, 10) : null;
  const organization = repository.organization;
  const isSudoer = await organization.isSudoer(login);
  const isPortalSudoer = await activeContext.isPortalAdministrator();
  if (isSudoer === true || isPortalSudoer === true) {
    repoPermissions.sudo = true;
  }
  try {
    const collaborator = await repository.getCollaborator(login);
    if (collaborator) {
      if (collaborator.permission === GitHubCollaboratorPermissionLevel.Admin) {
        repoPermissions.admin = repoPermissions.read = repoPermissions.write = true;
      } else if (collaborator.permission === GitHubCollaboratorPermissionLevel.Write) {
        repoPermissions.read = repoPermissions.write = true;
      } else if (collaborator.permission === GitHubCollaboratorPermissionLevel.Read) {
        repoPermissions.read = true;
      }
    }
  } catch (getCollaboratorPermissionError) {
    console.dir(getCollaboratorPermissionError);
  }
  if (repoPermissions.admin || repoPermissions.sudo) {
    repoPermissions.allowAdministration = true;
  }
  try {
    if (repoPermissions.sudo) {
      repoPermissions.allowJit = true;
    }
    const augmentedRepository = providers.microsoftGitHub.repository(repository);
    const canUnlock = await augmentedRepository.canUnlockLockedRepository(activeContext.getGitHubIdentity().id, login);
    if (canUnlock) {
      // This is a locked repo! This will truncate certain capabilities.
      repoPermissions.allowAdministration = true; // This person can *unlock [do compliance work]*, or *delete* or *archive* from the portal.
    } else {
      const isMaintainer = await augmentedRepository.isMaintainer(activeContext.corporateIdentity.id);
      if (isMaintainer) {
        repoPermissions.allowJit = true;
        repoPermissions.allowAdministration = true;
        repoPermissions.isMaintainer = true;
      }
    }
  } catch (maintainerError) {
    // telemetry?
    console.warn(maintainerError);
  }
  return repoPermissions;
};

export async function AddRepositoryPermissionsToRequest(req: ReposAppRequest, res, next) {
  if (req[repoPermissionsCacheKeyName]) {
    return next();
  }
  const activeContext = (req.individualContext || req.apiContext) as IndividualContext;
  const repository = req[requestScopedRepositoryKeyName] as Repository;
  const providers = req.app.settings.providers as IProviders;
  const permissions = await getComputedRepositoryPermissions(providers, activeContext, repository);
  req[repoPermissionsCacheKeyName] = permissions;
  return next();
};
