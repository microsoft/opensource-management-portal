//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { IEntityMetadataBaseOptions } from '../../../lib/entityMetadataProvider/entityMetadata.js';
import { RepositoryTeamCacheProvider, IRepositoryTeamCacheProvider } from './repositoryTeamCacheProvider.js';

export async function CreateRepositoryTeamCacheProviderInstance(
  options?: IEntityMetadataBaseOptions
): Promise<IRepositoryTeamCacheProvider> {
  const provider = new RepositoryTeamCacheProvider(options);
  await provider.initialize();
  return provider;
}
