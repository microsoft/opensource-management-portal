//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

const adalNode = require('adal-node');
const azureKeyVault = require('azure-keyvault');

module.exports = function createClient(kvConfig) {
  if (!kvConfig.clientId) {
    throw new Error('KeyVault client ID required at this time for the middleware to initialize.');
  }
  if (!kvConfig.clientSecret) {
    throw new Error('KeyVault client credential/secret required at this time for the middleware to initialize.');
  }
  const authenticator = (challenge, authCallback) => {
    const context = new adalNode.AuthenticationContext(challenge.authorization);
    return context.acquireTokenWithClientCredentials(challenge.resource, kvConfig.clientId, kvConfig.clientSecret, (tokenAcquisitionError, tokenResponse) => {
      if (tokenAcquisitionError) {
        return authCallback(tokenAcquisitionError);
      }
      const authorizationValue = `${tokenResponse.tokenType} ${tokenResponse.accessToken}`;
      return authCallback(null, authorizationValue);
    });
  };
  const credentials = new azureKeyVault.KeyVaultCredentials(authenticator);
  const keyVaultClient = new azureKeyVault.KeyVaultClient(credentials);
  return keyVaultClient;
};
