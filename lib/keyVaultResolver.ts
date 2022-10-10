//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { URL } from 'url';
import { IGetKeyVaultSecretClient } from '../middleware/keyVault';

const cachedKeys = new Map<string, string>();
const cacheKeysInMemory = true;

const secretsPath = '/secrets/';

export type IKeyVaultSecretResolver = (id: string) => Promise<string>;

async function keyVaultSecretResolver(keyVaultClient: IGetKeyVaultSecretClient, id: string) {
  const cachedKey = cachedKeys.get(id);
  if (cachedKey !== undefined) {
    return cachedKey;
  }
  const secretUrl = new URL(id);
  const vaultBaseUrl = secretUrl.origin;
  const secretClient = keyVaultClient.getSecretClientForVault(vaultBaseUrl);
  const i = secretUrl.pathname.indexOf(secretsPath);
  if (i < 0) {
    throw new Error('The requested resource must be a KeyVault secret');
  }
  let secretName = secretUrl.pathname.substr(i + secretsPath.length);
  let version = '';
  const versionIndex = secretName.indexOf('/');
  if (versionIndex >= 0) {
    version = secretName.substr(versionIndex + 1);
    secretName = secretName.substr(0, versionIndex);
  }
  const secretResponse = await secretClient.getSecret(secretName, { version });
  const secretValue = secretResponse.value;
  if (cacheKeysInMemory === true) {
    cachedKeys.set(id, secretValue);
  }
  return secretValue;
}

export default function createKeyVaultResolver(keyVaultClient: IGetKeyVaultSecretClient) {
  return keyVaultSecretResolver.bind(undefined, keyVaultClient) as IKeyVaultSecretResolver;
}
