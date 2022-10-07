//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { ErrorHelper, getProviders } from '../../transitional';
import { Repository } from '../../business/repository';
import { GitHubIdentitySource, IIndividualContextOptions, IndividualContext } from '../../user';
import getCompanySpecificDeployment from '../companySpecificDeployment';
import {
  ReposAppRequest,
  IProviders,
  GitHubCollaboratorPermissionLevel,
  ICorporateLink,
} from '../../interfaces';

const repoPermissionsCacheKeyName = 'repoPermissions';
const requestScopedRepositoryKeyName = 'repository';

export interface IContextualRepositoryPermissions {
  allowAdministration: boolean;
  admin: boolean;
  write: boolean;
  read: boolean;
  sudo: boolean;
  isLinked: boolean;
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

export async function getComputedRepositoryPermissionsByUsername(
  providers: IProviders,
  repository: Repository,
  githubLogin: string
) {
  const context = await createTemporaryContextByUsername(providers, githubLogin);
  return await getComputedRepositoryPermissions(providers, context, repository);
}

async function createTemporaryContextByUsername(providers: IProviders, githubLogin: string) {
  const { operations } = providers;
  let link: ICorporateLink = null;
  try {
    link = await operations.getLinkByThirdPartyUsername(githubLogin);
  } catch (error) {
    if (!ErrorHelper.IsNotFound(error)) {
      throw error;
    }
  }
  const options: IIndividualContextOptions = {
    corporateIdentity: link?.corporateId
      ? {
          id: link.corporateId,
          username: link.corporateUsername,
          displayName: link.corporateDisplayName,
        }
      : null,
    link,
    insights: null,
    operations,
    webApiContext: null,
    webContext: null,
  };
  const individualContext = new IndividualContext(options);
  if (!link) {
    const accountDetails = await operations.getAccountByUsername(githubLogin);
    individualContext.setSessionBasedGitHubIdentity({
      id: String(accountDetails.id),
      username: accountDetails.login,
      avatar: accountDetails.avatar_url,
      source: GitHubIdentitySource.Session,
    });
  }
  return individualContext;
}

export async function getComputedRepositoryPermissions(
  providers: IProviders,
  activeContext: IndividualContext,
  repository: Repository
) {
  const repoPermissions: IContextualRepositoryPermissions = {
    isLinked: false,
    allowAdministration: false,
    admin: false,
    sudo: false,
    write: false,
    read: false,
  };
  const companySpecific = getCompanySpecificDeployment();
  companySpecific?.middleware?.repoPermissions?.afterPermissionsInitialized &&
    companySpecific?.middleware?.repoPermissions?.afterPermissionsInitialized(
      providers,
      repoPermissions,
      activeContext
    );
  if (!activeContext.link) {
    return repoPermissions;
  }
  repoPermissions.isLinked = true;
  const login = activeContext.getGitHubIdentity().username;
  const organization = repository.organization;
  const isSudoer = await organization.isSudoer(login, activeContext.link);
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
  companySpecific?.middleware?.repoPermissions?.afterPermissionsComputed &&
    (await companySpecific?.middleware?.repoPermissions?.afterPermissionsComputed(
      providers,
      repoPermissions,
      activeContext,
      repository
    ));
  return repoPermissions;
}

export async function AddRepositoryPermissionsToRequest(req: ReposAppRequest, res, next) {
  if (req[repoPermissionsCacheKeyName]) {
    return next();
  }
  const activeContext = (req.individualContext || req.apiContext) as IndividualContext;
  const repository = req[requestScopedRepositoryKeyName] as Repository;
  const providers = getProviders(req);
  const permissions = await getComputedRepositoryPermissions(providers, activeContext, repository);
  req[repoPermissionsCacheKeyName] = permissions;
  return next();
}
