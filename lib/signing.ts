//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { CryptographyClient, KeyClient } from '@azure/keyvault-keys';

import { getEntraApplicationIdentityInstance } from './applicationIdentity.js';
import { CreateError } from './transitional.js';
import type { IProviders } from '../interfaces/providers.js';

let keyClient: KeyClient;
const mapKeyToCryptoClient = new Map<string, CryptographyClient>();

export async function getKeyVaultKeyCryptographyClient(providers: IProviders, keyUrl: string) {
  const uri = new URL(keyUrl);
  const vaultHost = uri.protocol + '//' + uri.host;
  const paths = uri.pathname.split('/').filter((x) => x);
  if (paths[0] !== 'keys') {
    throw CreateError.InvalidParameters('Must be a Key Vault key URI.');
  }
  const keyName = paths.pop();
  if (!keyClient) {
    const identityClient = getEntraApplicationIdentityInstance(providers, 'keyvault:keys');
    const tokenCredential = identityClient.getTokenCredential();
    keyClient = new KeyClient(vaultHost, tokenCredential);
  }
  const lookup = vaultHost + '/keys/' + keyName;
  let cryptoClient = mapKeyToCryptoClient.get(lookup);
  if (!cryptoClient) {
    cryptoClient = keyClient.getCryptographyClient(keyName);
    mapKeyToCryptoClient.set(lookup, cryptoClient);
  }
  return cryptoClient;
}
