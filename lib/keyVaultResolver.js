//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

const cachedKeys = new Map();
const cacheKeysInMemory = true;

function keyVaultSecretResolver(keyVaultClient, id, callback) {
  const cachedKey = cachedKeys.get(id);
  if (cachedKey !== undefined) {
    return callback(null, cachedKey);
  }

  keyVaultClient.getSecret(id, (getSecretError, secretResponse) => {
    if (getSecretError) {
      return callback(getSecretError);
    }
    const secretValue = secretResponse.value;
    if (cacheKeysInMemory === true) {
      cachedKeys.set(id, secretValue);
    }
    return callback(null, secretValue);
  });
}

module.exports = function createKeyVaultResolver(keyVaultClient) {
  return keyVaultSecretResolver.bind(undefined, keyVaultClient);
};
