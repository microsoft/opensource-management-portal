//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import type { IEntityMetadataBaseOptions } from '../../../lib/entityMetadataProvider/entityMetadata.js';
import {
  RepositoryCollaboratorCacheProvider,
  IRepositoryCollaboratorCacheProvider,
} from './repositoryCollaboratorCacheProvider.js';

export async function CreateRepositoryCollaboratorCacheProviderInstance(
  options?: IEntityMetadataBaseOptions
): Promise<IRepositoryCollaboratorCacheProvider> {
  const provider = new RepositoryCollaboratorCacheProvider(options);
  await provider.initialize();
  return provider;
}
