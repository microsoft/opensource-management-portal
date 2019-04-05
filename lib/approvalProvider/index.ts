//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

import { IApprovalProvider, IApprovalProviderCreateOptions } from './approvalProvider';
import { IProviders } from '../../transitional';

const approvalProviders = [
  'entityProviderPassthrough',
];

const defaultProviderName = 'entityProviderPassthrough';

export async function createAndInitializeApprovalProviderInstance(app, config, providers: IProviders, overrideProviderType?: string): Promise<IApprovalProvider> {
  const providerOptions : IApprovalProviderCreateOptions = {
    providers,
    config,
  };
  if (overrideProviderType) {
    providerOptions.overrideProviderType = overrideProviderType;
  }
  const provider = createApprovalProviderInstance(providerOptions);
  await provider.initialize();
  return provider;
}

export function createApprovalProviderInstance(providerCreateOptions: IApprovalProviderCreateOptions): IApprovalProvider {
  const config = providerCreateOptions.config;
  const providers = providerCreateOptions.providers;
  const provider = providerCreateOptions.overrideProviderType || config.github.approvals.provider.name || defaultProviderName;
  // FUTURE: should also include a parameter for "what kind of third-party", i.e. 'github' to create
  let found = false;
  let providerInstance: IApprovalProvider = null;
  approvalProviders.forEach(supportedProvider => {
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
