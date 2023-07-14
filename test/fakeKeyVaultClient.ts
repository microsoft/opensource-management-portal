//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { GetSecretOptions } from '@azure/keyvault-secrets';
import { randomUUID } from 'crypto';
import { IDictionary } from '../interfaces';
import { jsonError } from '../middleware';

type FakeSecret = {
  id: string; // old
  name: string;
  value: string;
  properties?: {
    tags: IDictionary<string>;
  };
};

function validateVaultUrl(vaultUrl: string) {
  if (!vaultUrl.startsWith('https://')) {
    throw new Error(`vaultUrl needs to start with https://: ${vaultUrl}`);
  }
  if (vaultUrl.endsWith('/')) {
    throw new Error(`vaultUrl should not have a trailing slash: ${vaultUrl}`);
  }
}

export function createFakeVaults() {
  const storedSecrets = new Map<string, FakeSecret>();

  return {
    getSecretClient: async (vaultUrl: string) => {
      validateVaultUrl(vaultUrl);
      return {
        getSecret: async (secretName: string, props?: GetSecretOptions) => {
          const secretVersion = props?.version || 'latest';
          const id = `${vaultUrl}/secrets/${secretName}/${secretVersion}`;
          const val = storedSecrets.get(id);
          if (val !== undefined) {
            return val;
          }
          throw jsonError(`Secret ${id} not found`, 404);
        },
      };
    },
    storeSecret: (vaultUrl: string, secretName: string, secretValue: string, tags: IDictionary<string>) => {
      validateVaultUrl(vaultUrl);
      const version = randomUUID();
      const id = `${vaultUrl}/secrets/${secretName}/${version}`;
      const secret = {
        id,
        name: secretName,
        value: secretValue,
        properties: {
          tags,
        },
      };

      storedSecrets.set(id, secret);
      const latestId = `${vaultUrl}/secrets/${secretName}/latest`;
      storedSecrets.set(latestId, secret);
      return id;
    },
  };
}
