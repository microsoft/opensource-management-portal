//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { SecretClient } from '@azure/keyvault-secrets';

import { getEntraApplicationIdentityInstance } from '../lib/applicationIdentity.js';

import type { IProviders } from '../interfaces/providers.js';

export interface IGetKeyVaultSecretClient {
  getSecretClientForVault(vault: string): SecretClient;
}

export default function createClient(providers: IProviders) {
  const clientIdentity = getEntraApplicationIdentityInstance(providers, 'keyvault');
  const tokenCredential = clientIdentity.getTokenCredential();
  const vaultToInstance = new Map<string, SecretClient>();
  const getSecretClientForVault = (vault: string) => {
    let client = vaultToInstance.get(vault);
    if (!client) {
      client = new SecretClient(vault, tokenCredential);
      vaultToInstance.set(vault, client);
    }
    return client;
  };
  return { getSecretClientForVault };
}
