//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { RepositoryMetadataEntity } from '../../entities/repositoryMetadata/repositoryMetadata';
import { GitHubRepositoryVisibility, ICorporateLink } from '../../interfaces';
import { RepositoryLockdownCreateOptions } from './interfaces';

export async function initializeRepositoryMetadata(parameters: RepositoryLockdownCreateOptions) {
  const {
    username,
    thirdPartyId,
    transferSourceRepositoryLogin,
    lockdownLog,
    lockdownState,
    link,
    providers,
    instances,
  } = parameters;
  const { repository } = instances;
  const { repositoryMetadataProvider } = providers;
  const { organization } = repository;
  try {
    // Repository metadata is used to lock down the security of the repository setup system. Only
    // a complete system administrator or the initial creator of a repository is able to complete
    // the initial repository setup process.
    let repositoryMetadata: RepositoryMetadataEntity = null;
    try {
      repositoryMetadata = await repositoryMetadataProvider.getRepositoryMetadata(String(repository.id));
    } catch (doesNotExist) {
      // ignore: 404 is standard here
    }
    if (repositoryMetadata) {
      lockdownLog.push(`Repository metadata already exists for repository ID ${repository.id}`);
      const updateMetadata = populateRepositoryMetadata(
        repositoryMetadata,
        username,
        thirdPartyId,
        link,
        transferSourceRepositoryLogin
      );
      await repositoryMetadataProvider.updateRepositoryMetadata(updateMetadata);
      lockdownLog.push(`Updated the repository metadata with username and link information`);
    } else {
      repositoryMetadata = populateRepositoryMetadata(
        new RepositoryMetadataEntity(),
        username,
        thirdPartyId,
        link,
        transferSourceRepositoryLogin
      );
      repositoryMetadata.created = new Date();
      repositoryMetadata.lockdownState = lockdownState;
      repositoryMetadata.repositoryId = repository.id.toString();
      repositoryMetadata.repositoryName = repository.name;
      repositoryMetadata.organizationName = organization.name;
      repositoryMetadata.organizationId = organization.id.toString();
      repositoryMetadata.initialRepositoryDescription = repository.description;
      repositoryMetadata.initialRepositoryHomepage = repository.homepage;
      repositoryMetadata.initialRepositoryVisibility = repository.private
        ? GitHubRepositoryVisibility.Private
        : GitHubRepositoryVisibility.Public;
      await repositoryMetadataProvider.createRepositoryMetadata(repositoryMetadata);
      lockdownLog.push(
        `Created the initial repository metadata indicating the repo was created by ${username}`
      );
    }
  } catch (metadataSystemError) {
    console.dir(metadataSystemError);
    lockdownLog.push(`While writing repository metadata an error: ${metadataSystemError.message}`);
  }
}

function populateRepositoryMetadata(
  entity: RepositoryMetadataEntity,
  username: string,
  userId: number,
  link: ICorporateLink,
  transferSourceRepositoryLogin: string
) {
  entity.createdByThirdPartyUsername = username;
  entity.createdByThirdPartyId = userId.toString();
  if (link) {
    entity.createdByCorporateDisplayName = link.corporateDisplayName;
    entity.createdByCorporateId = link.corporateId;
    entity.createdByCorporateUsername = link.corporateUsername;
  }
  if (transferSourceRepositoryLogin) {
    entity.transferSource = transferSourceRepositoryLogin;
  }
  return entity;
}
