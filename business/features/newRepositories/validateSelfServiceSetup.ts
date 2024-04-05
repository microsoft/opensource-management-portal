//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { RepositoryMetadataEntity } from '../../entities/repositoryMetadata/repositoryMetadata';
import { RepositoryLockdownState } from '../../../interfaces';
import { IndividualContext } from '../../user';

export async function validateUserCanConfigureRepository(
  metadata: RepositoryMetadataEntity,
  individualContext: IndividualContext
): Promise<void> {
  if (
    (!individualContext.corporateIdentity ||
      !individualContext.corporateIdentity.id ||
      !metadata.createdByCorporateId) &&
    (!individualContext.getGitHubIdentity() || !individualContext.getGitHubIdentity().id)
  ) {
    throw new Error(
      'The authenticated user or the linked identity of the repo creator did not have a corporate ID available'
    );
  }
  if (
    (metadata.createdByCorporateId &&
      individualContext.corporateIdentity.id !== metadata.createdByCorporateId) ||
    (metadata.createdByThirdPartyId &&
      individualContext.getGitHubIdentity()?.id !== metadata.createdByThirdPartyId)
  ) {
    throw new Error(
      'Only the original linked user who first created this repository can classify the repository'
    );
  }
  if (!metadata.lockdownState) {
    throw new Error('The repository has not been locked down');
  }
  if (metadata.lockdownState === RepositoryLockdownState.Unlocked) {
    throw new Error('The repository has already been unlocked');
  }
  if (metadata.lockdownState === RepositoryLockdownState.AdministratorLocked) {
    throw new Error('This repository is locked and requires administrator approval.');
  }
  if (metadata.lockdownState === RepositoryLockdownState.ComplianceLocked) {
    throw new Error('This repository is locked because compliance information is missing.');
  }
  if (metadata.lockdownState !== RepositoryLockdownState.Locked) {
    throw new Error(`Unsupported repository lockdown state ${metadata.lockdownState}`);
  }
}
