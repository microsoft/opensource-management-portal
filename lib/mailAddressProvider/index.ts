//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

import { ICallback } from '../../transitional';

export interface IMailAddressProvider {
  getAddressFromUpn(upn: string, callback: ICallback<string>);
  getCorporateEntry?: any;
}

export function GetAddressFromUpnAsync(mailAddressProvider: IMailAddressProvider, upn: string): Promise<string> {
  return new Promise((resolve, reject) => {
    mailAddressProvider.getAddressFromUpn(upn, (error, address) => {
      return error ? reject(error) : resolve(address);
    });
  });
}

export function createMailAddressProviderInstance(options: any, callback: ICallback<IMailAddressProvider>) {
  const config = options.config;
  const mailAddressesConfig = config.mailAddresses || {};
  const provider = mailAddressesConfig.provider || 'passthroughMailAddressProvider';
  if (!provider) {
    return callback(null);
  }
  let found = false;
  const supportedProviders = [
    'microsoftMailAddressProvider',
    'mockMailAddressProvider',
    'passthroughMailAddressProvider',
  ];
  supportedProviders.forEach((supportedProvider) => {
    if (supportedProvider === provider) {
      found = true;
      let providerInstance: IMailAddressProvider = null;
      try {
        providerInstance = require(`./${supportedProvider}`)(options);
      }
      catch (createError) {
        return callback(createError);
      }
      return callback(null, providerInstance);
    }
  });
  if (found === false) {
    return callback(new Error(`The mail address provider "${provider}" is not implemented or configured at this time.`));
  }
};
