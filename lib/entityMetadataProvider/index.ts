//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

import { IEntityMetadataProvider, IEntityMetadataProviderCreateOptions } from './entityMetadataProvider';
import { IProviders } from '../../transitional';

const providerTypes = [
  'memory',
  // 'table',
  // 'postgres',
];

const defaultProviderName = 'memory';

export async function createAndInitializeEntityMetadataProviderInstance(app, config, providers: IProviders, overrideProviderType?: string): Promise<IEntityMetadataProvider> {
  const providerOptions : IEntityMetadataProviderCreateOptions = {
    providers,
    config,
  };
  if (overrideProviderType) {
    providerOptions.overrideProviderType = overrideProviderType;
  }
  const provider = createEntityMetadataProviderInstance(providerOptions);
  await provider.initialize();
  return provider;
}

export function createEntityMetadataProviderInstance(providerCreateOptions: IEntityMetadataProviderCreateOptions): IEntityMetadataProvider {
  const config = providerCreateOptions.config;
  const providers = providerCreateOptions.providers;
  const provider = providerCreateOptions.overrideProviderType || config.github.approvals.provider.name || defaultProviderName;
  let found = false;
  let providerInstance: IEntityMetadataProvider = null;
  providerTypes.forEach(supportedProvider => {
    if (supportedProvider === provider) {
      found = true;
      try {
        providerInstance = require(`./${supportedProvider}`)(providers, config);
      } catch (createError) {
        throw createError;
      }
    }
  });
  if (found === false) {
    throw new Error(`The approval provider "${provider}" is not implemented or configured at this time.`);
  }
  return providerInstance;
};
