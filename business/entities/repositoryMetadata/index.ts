//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { IRepositoryMetadataProvider, RepositoryMetadataProvider } from './repositoryMetadataProvider.js';

import type { IEntityMetadataBaseOptions } from '../../../lib/entityMetadataProvider/entityMetadata.js';

export async function createAndInitializeRepositoryMetadataProviderInstance(
  options?: IEntityMetadataBaseOptions
): Promise<IRepositoryMetadataProvider> {
  const provider = new RepositoryMetadataProvider(options);
  await provider.initialize();
  return provider;
}
