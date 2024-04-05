//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { ClientSecretCredential } from '@azure/identity';
import { SecretClient } from '@azure/keyvault-secrets';

export interface IKeyVaultConfigurationOptions {
  tenantId: string;
  clientId: string;
  clientSecret: string;
}

export interface IGetKeyVaultSecretClient {
  getSecretClientForVault(vault: string): SecretClient;
}

export default function createClient(kvConfig: IKeyVaultConfigurationOptions) {
  if (!kvConfig.tenantId) {
    throw new Error('KeyVault tenantId required at this time for the middleware to initialize.');
  }
  if (!kvConfig.clientId) {
    throw new Error('KeyVault client ID required at this time for the middleware to initialize.');
  }
  if (!kvConfig.clientSecret) {
    throw new Error(
      'KeyVault client credential/secret required at this time for the middleware to initialize.'
    );
  }
  const credentials = new ClientSecretCredential(kvConfig.tenantId, kvConfig.clientId, kvConfig.clientSecret);
  const vaultToInstance = new Map<string, SecretClient>();
  const getSecretClientForVault = (vault: string) => {
    let client = vaultToInstance.get(vault);
    if (!client) {
      client = new SecretClient(vault, credentials);
      vaultToInstance.set(vault, client);
    }
    return client;
  };
  return { getSecretClientForVault };
}
