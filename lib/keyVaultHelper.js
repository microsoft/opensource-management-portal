//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

const adalNode = require('adal-node');
const async = require('async');
const azureKeyVault = require('azure-keyvault');
const objectPath = require('object-path');

// Key Vault Configuration Assumptions:
// A configuration setting that is a string and contains '.vault.azure.net'
// should be immediately resolved, storing the resulting secret value in
// the original place of the secret ID.
//
// However, a setting which starts with keyvault:// (a fake scheme for this
// app) is instead translated to a standard KeyVault secret ID starting
// with 'https://', so the program can actively work with the secret at
// runtime.,

const partialKeyVaultHost = '.vault.azure.net';
const deferredKeyVaultPrefix = 'keyvault://';
const keyVaultPrefix = 'https://';
const obfuscatedSettingsPrefix = 'obfuscatedConfig.';

function translateConfig(keyVaultClient, config, callback) {
  let paths = null;
  try {
    paths = identifyKeyVaultValuePaths(config);
  } catch(parseError) {
    return callback(parseError);
  }
  async.forEachOf(paths, translateSetting.bind(undefined, config, keyVaultClient), callback);
}

function translateSetting(config, keyVaultClient, secret, path, callback) {
  // Deferred setting - this is a configuration value to be used later in
  // the app's execution for direct key vault secret calls
  if (secret.startsWith(deferredKeyVaultPrefix)) {
    const standardSecretId = secret.replace(deferredKeyVaultPrefix, keyVaultPrefix);
    console.log(`replaced ${secret} deferring path to just ${standardSecretId}`);
    objectPath.set(config, path, standardSecretId);
    return callback();
  }

  // Resolve the secret immediately, replacing the secret URI
  keyVaultClient.getSecret(secret, (getSecretError, secretResponse) => {
    if (getSecretError) {
      return callback(getSecretError);
    }
    objectPath.set(config, path, secretResponse.value);
    return callback();
  });
}

// Whether to process the specific setting
function processConfigurationSetting(path) {
  return false === path.startsWith(obfuscatedSettingsPrefix);
}

function valueIsVault(val) {
  return typeof val !== 'string' ? false : (val.includes(partialKeyVaultHost) && (val.startsWith(keyVaultPrefix) || val.startsWith(deferredKeyVaultPrefix)));
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
      const path = prefix + property;
      if (processConfigurationSetting(path)) {
        paths[path] = value;
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
