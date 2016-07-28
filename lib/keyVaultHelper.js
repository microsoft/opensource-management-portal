//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

const adalNode = require('adal-node');
const async = require('async');
const azureKeyVault = require('azure-keyvault');
const objectPath = require('object-path');

function translateConfig(keyVaultClient, config, callback) {
  let paths = null;
  try {
    paths = identifyKeyVaultValuePaths(config);
  } catch(parseError) {
    return callback(parseError);
  }
  async.forEachOf(paths, (secret, path, next) => {
    keyVaultClient.getSecret(secret, (getSecretError, secretResponse) => {
      if (getSecretError) {
        return next(getSecretError);
      }
      objectPath.set(config, path, secretResponse.value);
      next();
    });
  }, (asyncError) => {
    if (asyncError) {
      return callback(asyncError);
    }
    callback();
  });
}

function valueIsVault(val) {
  if (typeof val !== 'string') {
    return false;
  }
  return (val.startsWith('https://') && val.includes('.vault.azure.net'));
}

function identifyKeyVaultValuePaths(node, prefix) {
  prefix = prefix !== undefined ? prefix + '.' : '';
  const paths = {};
  for (const property in node) {
    const value = node[property];
    if (typeof value === 'object') {
      Object.assign(paths, identifyKeyVaultValuePaths(value, prefix + property));
    }
    if (typeof value === 'string' && valueIsVault(value)) {
      if (property.includes('.')) {
        throw new Error(`Property name "${property}" in configuration includes a dot; cannot be processed at this time.`);
      }
      if (!prefix.startsWith('obfuscatedConfig.')) {
        paths[prefix + property] = value;
      }
    }
  }
  return paths;
}

function createClient(config, callback) {
  const clientId = config.activeDirectory.clientId;
  const clientSecret = config.activeDirectory.clientSecret;
  const authenticator = (challenge, authCallback) => {
    const context = new adalNode.AuthenticationContext(challenge.authorization);
    return context.acquireTokenWithClientCredentials(challenge.resource, clientId, clientSecret, (tokenAcquisitionError, tokenResponse) => {
      if (tokenAcquisitionError) {
        return authCallback(tokenAcquisitionError);
      }
      const authorizationValue = `${tokenResponse.tokenType} ${tokenResponse.accessToken}`;
      return authCallback(null, authorizationValue);
    });
  };
  const credentials = new azureKeyVault.KeyVaultCredentials(authenticator);
  const keyVaultClient = new azureKeyVault.KeyVaultClient(credentials);
  callback(null, keyVaultClient);
}

module.exports = {
  createClient: createClient,
  resolveKeyVaultConfiguration: translateConfig,
};
