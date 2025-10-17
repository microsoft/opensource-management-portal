//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { Repository } from '../../index.js';
import { RepositoryMetadataEntity } from '../../entities/repositoryMetadata/repositoryMetadata.js';
import { IndividualContext } from '../../user/index.js';
import { validateUserCanSelfDeleteRepository } from './validateSelfServiceDelete.js';
import { validateUserCanConfigureRepository } from './validateSelfServiceSetup.js';

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
