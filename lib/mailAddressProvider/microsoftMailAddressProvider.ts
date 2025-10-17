//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { IProviders } from '../../interfaces/index.js';
import { IMailAddressProvider } from './index.js';

export default function createMailAddressProvider(options): IMailAddressProvider {
  const providers = options.providers as IProviders;
  if (!providers) {
    throw new Error(
      'The microsoftMailAddressProvider requires that all provider instances are passed in as options'
    );
  }
  return {
    getAddressFromUpn: async (upn: string) => {
      return providers.graphProvider.getMailAddressByUsername(upn);
    },
  } as IMailAddressProvider;
}
