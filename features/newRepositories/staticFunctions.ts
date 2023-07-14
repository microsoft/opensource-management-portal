//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { Repository } from '../../business';
import { RepositoryMetadataEntity } from '../../entities/repositoryMetadata/repositoryMetadata';
import { IndividualContext } from '../../business/user';
import { validateUserCanSelfDeleteRepository } from './validateSelfServiceDelete';
import { validateUserCanConfigureRepository } from './validateSelfServiceSetup';

export const repositoryLockdownStatics = {
  ValidateUserCanSelfDeleteRepository: (
    repository: Repository,
    metadata: RepositoryMetadataEntity,
    individualContext: IndividualContext,
    daysAfterCreateToAllowSelfDelete: number
  ): Promise<void> =>
    validateUserCanSelfDeleteRepository(
      repository,
      metadata,
      individualContext,
      daysAfterCreateToAllowSelfDelete
    ),

  ValidateUserCanConfigureRepository: (
    metadata: RepositoryMetadataEntity,
    individualContext: IndividualContext
  ): Promise<void> => validateUserCanConfigureRepository(metadata, individualContext),
};
