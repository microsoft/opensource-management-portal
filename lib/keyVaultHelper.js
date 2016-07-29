//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

// CONSIDER: A painless-config wrapper to use KeyVault. That would happen
// earlier than this implementation which operations on a configuration
// graph.

const adalNode = require('adal-node');
const async = require('async');
const azureKeyVault = require('azure-keyvault');
const objectPath = require('object-path');
const url = require('url');

// Key Vault Configuration Assumptions:
// In URL syntax, we define a custom scheme of "keyvault://" which resolves
// a KeyVault secret ID, replacing the original. To use a tag (a custom
// attribute on a secret - could be a username for example), use the tag
// name as the auth parameter of the URL.
//
// For example:
//   keyvault://myCustomTag@keyvaultname.vault.azure.net/secrets/secret-value-name/secretVersion",
//
// Would resolve the "myCustomTag" value instead of the secret value.
//
// In the case that a KeyVault secret ID is needed inside the app, and not
// handled at startup, then the secret ID (a URI) can be included without
// the custom keyvault:// scheme.

const keyVaultProtocol = 'keyvault:';
const httpsProtocol = 'https:';

function resolveConfiguration(keyVaultClient, config, callback) {
  let paths = null;
  try {
    paths = identifyKeyVaultValuePaths(config);
  } catch(parseError) {
    return callback(parseError);
  }
  async.forEachOf(paths, resolveKeyVaultValue.bind(undefined, config, keyVaultClient), callback);
}

function resolveKeyVaultValue(config, keyVaultClient, keyVaultUrl, path, callback) {
  keyVaultUrl.protocol = httpsProtocol;
  const tag = keyVaultUrl.auth;
  if (tag !== null) {
    keyVaultUrl.auth = null;
  }
  const secretId = url.format(keyVaultUrl);
  keyVaultClient.getSecret(secretId, (getSecretError, secretResponse) => {
    if (getSecretError) {
      return callback(getSecretError);
    }
    let value = undefined;
    if (tag === null) {
      value = secretResponse.value;
    } else if (secretResponse.tags) {
      value = secretResponse.tags[tag];
    }
    objectPath.set(config, path, value);
    return callback();
  });
}

function getUrlIfVault(value) {
  try {
    const keyVaultUrl = url.parse(value);
    if (keyVaultUrl.protocol === keyVaultProtocol) {
      return keyVaultUrl;
    }
  }
  catch (typeError) {
    /* ignore */
  }
  return undefined;
}

function identifyKeyVaultValuePaths(node, prefix) {
  prefix = prefix !== undefined ? prefix + '.' : '';
  const paths = {};
  for (const property in node) {
    const value = node[property];
    if (typeof value === 'object') {
      Object.assign(paths, identifyKeyVaultValuePaths(value, prefix + property));
      continue;
    }
    if (typeof value !== 'string') {
      continue;
    }
    const keyVaultUrl = getUrlIfVault(value);
    if (keyVaultUrl === undefined) {
      continue;
    }
    paths[prefix + property] = keyVaultUrl;
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
  resolveKeyVaultConfiguration: resolveConfiguration,
};
