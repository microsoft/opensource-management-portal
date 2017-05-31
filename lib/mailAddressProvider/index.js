//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

const providers = [
  'microsoftMailAddressProvider',
  'mockMailAddressProvider',
  'passthroughMailAddressProvider',
];

module.exports = function createMailAddressProviderInstance(options, callback) {
  const config = options.config;
  const mailAddressesConfig = config.mailAddresses || {};
  const provider = mailAddressesConfig.provider || 'passthroughMailAddressProvider';
  if (!provider) {
    return callback();
  }
  let found = false;
  providers.forEach((supportedProvider) => {
    if (supportedProvider === provider) {
      found = true;
      let providerInstance = null;
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
