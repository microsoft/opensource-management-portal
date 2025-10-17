//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { IEntityMetadataBaseOptions } from '../../../lib/entityMetadataProvider/entityMetadata.js';
import { IRepositoryCacheProvider, RepositoryCacheProvider } from './repositoryCacheProvider.js';

export async function CreateRepositoryCacheProviderInstance(
  options?: IEntityMetadataBaseOptions
): Promise<IRepositoryCacheProvider> {
  const provider = new RepositoryCacheProvider(options);
  await provider.initialize();
  return provider;
}
