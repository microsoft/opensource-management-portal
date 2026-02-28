//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { NextFunction, Response } from 'express';

import { ErrorHelper, getProviders } from '../../lib/transitional.js';
import { Repository } from '../../business/repository.js';
import {
  GitHubIdentitySource,
  IIndividualContextOptions,
  IndividualContext,
} from '../../business/user/index.js';
import getCompanySpecificDeployment from '../companySpecificDeployment.js';
import {
  ReposAppRequest,
  IProviders,
  GitHubCollaboratorPermissionLevel,
  ICorporateLink,
  GitHubRepositoryPermission,
  AppInsightsTelemetryClient,
} from '../../interfaces/index.js';

const repoPermissionsCacheKeyName = 'repoPermissions';
const requestScopedRepositoryKeyName = 'repository';

export interface IContextualRepositoryPermissions {
  allowAdministration: boolean;
  admin: boolean;
  maintain: boolean;
  write: boolean;
  triage: boolean;
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

// export async function getComputedRepositoryPermissionsByUsername(
//   providers: IProviders,
//   insights: AppInsightsTelemetryClient,
//   repository: Repository,
//   githubLogin: string
// ) {
//   const context = await createTemporaryContextByUsername(providers, insights, githubLogin);
//   return await getComputedRepositoryPermissions(providers, context, repository);
// }

async function createTemporaryContextByUsername(
  providers: IProviders,
  insights: AppInsightsTelemetryClient,
  githubLogin: string
) {
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
    insights,
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
    maintain: false,
    sudo: false,
    write: false,
    triage: false,
    read: false,
  };
  const companySpecific = getCompanySpecificDeployment();
  if (companySpecific?.middleware?.repoPermissions?.afterPermissionsInitialized) {
    companySpecific?.middleware?.repoPermissions?.afterPermissionsInitialized(
      providers,
      repoPermissions,
      activeContext
    );
  }
  const isPortalSudoer = await activeContext.isPortalAdministrator();
  if (isPortalSudoer) {
    repoPermissions.sudo = true;
  }
  repoPermissions.isLinked = !!activeContext.link;
  const hasGitHubIdentity = !!activeContext?.getGitHubIdentity()?.username;
  if (hasGitHubIdentity) {
    const login = activeContext.getGitHubIdentity().username;
    const organization = repository.organization;
    const isSudoer = await organization.isSudoer(login, activeContext.link);
    if (isSudoer) {
      repoPermissions.sudo = true;
    }
    try {
      const collaborator = await repository.getCollaborator(login);
      if (collaborator) {
        const consolidated = collaborator.asGitHubLegacyRepositoryPermission();
        if (consolidated === GitHubRepositoryPermission.Admin) {
          repoPermissions.admin =
            repoPermissions.maintain =
            repoPermissions.read =
            repoPermissions.triage =
            repoPermissions.write =
              true;
        } else if (consolidated === GitHubRepositoryPermission.Maintain) {
          repoPermissions.maintain =
            repoPermissions.write =
            repoPermissions.triage =
            repoPermissions.read =
              true;
        } else if (consolidated === GitHubRepositoryPermission.Push) {
          repoPermissions.read = repoPermissions.write = true;
        } else if (consolidated === GitHubRepositoryPermission.Triage) {
          repoPermissions.triage = repoPermissions.read = true;
        } else if (consolidated === GitHubRepositoryPermission.Pull) {
          repoPermissions.read = true;
        }
      }
    } catch (getCollaboratorPermissionError) {
      console.dir(getCollaboratorPermissionError);
    }
  }
  if (repoPermissions.admin || repoPermissions.sudo) {
    repoPermissions.allowAdministration = true;
  }
  if (companySpecific?.middleware?.repoPermissions?.afterPermissionsComputed) {
    await companySpecific?.middleware?.repoPermissions?.afterPermissionsComputed(
      providers,
      repoPermissions,
      activeContext,
      repository
    );
  }
  return repoPermissions;
}

export async function AddRepositoryPermissionsToRequest(
  req: ReposAppRequest,
  res: Response,
  next: NextFunction
) {
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
