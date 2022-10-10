//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import microsoftMailAddressProvider from './microsoftMailAddressProvider';
import mockMailAddressProvider from './mockMailAddressProvider';
import passthroughMailAddressProvider from './passthroughMailAddressProvider';

const supportedProvidersMapping = {
  microsoftMailAddressProvider,
  mockMailAddressProvider,
  passthroughMailAddressProvider,
};

export interface IMailAddressProvider {
  getAddressFromUpn(upn: string): Promise<string>;
}

export function createMailAddressProviderInstance(options: any): IMailAddressProvider {
  const config = options.config;
  const mailAddressesConfig = config.mailAddresses || {};
  const provider = mailAddressesConfig.provider || 'passthroughMailAddressProvider';
  if (!provider) {
    return null;
  }
  let found = false;
  const supportedProviders = Object.getOwnPropertyNames(supportedProvidersMapping);
  for (const supportedProvider of supportedProviders) {
    if (supportedProvider === provider) {
      const createFunction = supportedProvidersMapping[supportedProvider];
      found = true;
      const providerInstance: IMailAddressProvider = createFunction.call(null, options);
      return providerInstance as IMailAddressProvider;
    }
  }
  if (found === false) {
    throw new Error(`The mail address provider "${provider}" is not implemented or configured at this time.`);
  }
}
