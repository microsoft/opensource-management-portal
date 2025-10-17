//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { RepositoryMetadataEntity } from '../../entities/repositoryMetadata/repositoryMetadata.js';
import { GitHubRepositoryVisibility, type ICorporateLink } from '../../../interfaces/index.js';
import { ErrorHelper } from '../../../lib/transitional.js';

import type { RepositoryLockdownCreateOptions } from './interfaces.js';
import type { GitHubWebhookRepositoryEventBody } from './types.js';

// this function is only used by the newRepositoryLockdown.ts file

export async function initializeRepositoryMetadata(
  parameters: RepositoryLockdownCreateOptions,
  webhookEvent: GitHubWebhookRepositoryEventBody,
  doNotLockdown: boolean
) {
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
  const { insights, repositoryMetadataProvider } = providers;
  const { organization } = repository;
  try {
    // Repository metadata is used to lock down the security of the repository setup system. Only
    // a complete system administrator or the initial creator of a repository is able to complete
    // the initial repository setup process.
    let repositoryMetadata: RepositoryMetadataEntity = null;
    try {
      repositoryMetadata = await repositoryMetadataProvider.getRepositoryMetadata(String(repository.id));
    } catch (error) {
      if (!ErrorHelper.IsNotFound(error)) {
        insights?.trackException({
          exception: error,
          properties: {
            content: 'RepositoryMetadataProviderGetRepositoryMetadataError',
            message: error.message,
            repositoryId: repository.id.toString(),
            repositoryName: repository.name,
            organizationName: organization.name,
            organizationId: organization.id.toString(),
          },
        });
      }
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
      const whr = webhookEvent.repository;
      if (!repositoryMetadata.created && whr.created_at) {
        updateMetadata.created = new Date(whr.created_at);
      }
      if (!repositoryMetadata.initialRepositoryDescription && whr.description) {
        updateMetadata.initialRepositoryDescription = whr.description;
      }
      if (!repositoryMetadata.initialRepositoryHomepage && whr.homepage) {
        updateMetadata.initialRepositoryHomepage = whr.homepage;
      }
      if (!repositoryMetadata.initialRepositoryVisibility && whr.visibility) {
        updateMetadata.initialRepositoryVisibility = whr.visibility;
      }
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
      if (doNotLockdown === true) {
        lockdownLog.push(`The repository is not being locked down but would have been: ${lockdownState}`);
      } else {
        repositoryMetadata.lockdownState = lockdownState;
      }
      repositoryMetadata.repositoryId = repository.id.toString();
      repositoryMetadata.repositoryName = repository.name;
      repositoryMetadata.organizationName = organization.name;
      repositoryMetadata.organizationId = organization.id.toString();
      const whr = webhookEvent.repository;
      if (!repositoryMetadata.created && whr.created_at) {
        repositoryMetadata.created = new Date(whr.created_at);
      } else {
        repositoryMetadata.created = new Date();
      }
      if (!repositoryMetadata.initialRepositoryDescription && whr.description) {
        repositoryMetadata.initialRepositoryDescription = whr.description;
      } else {
        repositoryMetadata.initialRepositoryDescription = repository.description;
      }
      if (!repositoryMetadata.initialRepositoryHomepage && whr.homepage) {
        repositoryMetadata.initialRepositoryHomepage = whr.homepage;
      } else {
        repositoryMetadata.initialRepositoryHomepage = repository.homepage;
      }
      if (!repositoryMetadata.initialRepositoryVisibility && whr.visibility) {
        repositoryMetadata.initialRepositoryVisibility = whr.visibility;
      } else {
        repositoryMetadata.initialRepositoryVisibility =
          repository.visibility ||
          (repository.private ? GitHubRepositoryVisibility.Private : GitHubRepositoryVisibility.Public);
      }
      repositoryMetadata.metadataSource = 'lockdown:initialize';
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
