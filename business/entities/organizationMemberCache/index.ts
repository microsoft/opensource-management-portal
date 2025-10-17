//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import type { IEntityMetadataBaseOptions } from '../../../lib/entityMetadataProvider/entityMetadata.js';
import {
  OrganizationMemberCacheProvider,
  IOrganizationMemberCacheProvider,
} from './organizationMemberCacheProvider.js';

export async function CreateOrganizationMemberCacheProviderInstance(
  options?: IEntityMetadataBaseOptions
): Promise<IOrganizationMemberCacheProvider> {
  const provider = new OrganizationMemberCacheProvider(options);
  await provider.initialize();
  return provider;
}
