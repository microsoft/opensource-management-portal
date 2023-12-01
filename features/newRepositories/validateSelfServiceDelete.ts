//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { DateTime } from 'luxon';

import { Repository } from '../../business';
import { RepositoryMetadataEntity } from '../../entities/repositoryMetadata/repositoryMetadata';
import { RepositoryLockdownState } from '../../interfaces';
import { IndividualContext } from '../../business/user';
import { daysInMilliseconds } from '../../utils';

export async function validateUserCanSelfDeleteRepository(
  repository: Repository,
  metadata: RepositoryMetadataEntity,
  individualContext: IndividualContext,
  daysAfterCreateToAllowSelfDelete: number
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
      'Only the original linked user who first created this repository can delete the repository'
    );
  }
  // any lockdown state is permitted for self-deletes
  const isLockedForkOrNotSetupYet =
    metadata.lockdownState === RepositoryLockdownState.AdministratorLocked ||
    metadata.lockdownState === RepositoryLockdownState.Locked;
  const isWindowOk =
    new Date() <=
    new Date(
      new Date(repository.created_at).getTime() + daysInMilliseconds(daysAfterCreateToAllowSelfDelete)
    );
  if (!isWindowOk && !isLockedForkOrNotSetupYet) {
    const asDate = new Date(repository.created_at);
    throw new Error(
      `The ${repository.name} repo was created ${DateTime.fromJSDate(asDate).toLocaleString(
        DateTime.DATE_SHORT
      )}. Repos can only be deleted by their creator ${daysAfterCreateToAllowSelfDelete} days after being created.`
    );
  }
}
