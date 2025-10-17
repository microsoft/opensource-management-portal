//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import type { IEntityMetadataBaseOptions } from '../../../lib/entityMetadataProvider/entityMetadata.js';
import { IOrganizationSettingProvider, OrganizationSettingProvider } from './organizationSettingProvider.js';

export async function createAndInitializeOrganizationSettingProviderInstance(
  options?: IEntityMetadataBaseOptions
): Promise<IOrganizationSettingProvider> {
  const provider = new OrganizationSettingProvider(options);
  await provider.initialize();
  return provider;
}
