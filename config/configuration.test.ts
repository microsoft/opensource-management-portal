//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { createFakeVaults } from '../lib/config/fakeKeyVaultClient.js';

import createAndWrapKeyVaultClient from '../lib/config/keyVaultConfigurationResolver.js';

const testVaultUri = 'https://fake.vault';

async function createFakeWithKeys() {
  const keyVault = createFakeVaults();
  const keyVaultClient = await keyVault.getSecretClient(testVaultUri);
  const secretId = keyVault.storeSecret(testVaultUri, 'test', 'big secret', {
    tag1: 'p1',
    tag2: 'and tag 2',
  });
  const keyVaultResolver = createAndWrapKeyVaultClient(keyVault as any);
  return { keyVaultClient, secretId, keyVaultResolver };
}

describe('configuration', () => {
  describe('keyVaultHelper', () => {
    it('non-URL values passthrough', async () => {
      const { keyVaultClient, secretId, keyVaultResolver } = await createFakeWithKeys();
      const config = {
        a: 'animal',
        b: 'bat',
        c: 'cherry',
        d: true,
        e: 5,
      };
      await keyVaultResolver.getObjectSecrets(config);
      expect(config.a).toEqual('animal');
      expect(config.b).toEqual('bat');
      expect(config.c).toEqual('cherry');
      expect(config.d).toStrictEqual(true);
      expect(config.e).toEqual(5);
    });

    it('keyvault:// protocol works', async () => {
      const { keyVaultClient, secretId, keyVaultResolver } = await createFakeWithKeys();
      const keyVaultSchemeSecretId = secretId.replace('https://', 'keyvault://');
      const config = {
        bigPasscode: keyVaultSchemeSecretId,
      };
      await keyVaultResolver.getObjectSecrets(config);
      expect(config.bigPasscode).toEqual('big secret');
    });

    it('deeply nested Key Vault URLs work', async () => {
      const { keyVaultClient, secretId, keyVaultResolver } = await createFakeWithKeys();
      const keyVaultSchemeSecretId = secretId.replace('https://', 'keyvault://');
      const config = {
        deep: {
          object: {
            nesting: {
              test: {
                value: {
                  is: keyVaultSchemeSecretId,
                },
              },
            },
          },
        },
      };
      await keyVaultResolver.getObjectSecrets(config);
      expect(config.deep.object.nesting.test.value.is).toEqual('big secret');
    });

    it('keyvault:// tag properties work', async () => {
      const { keyVaultClient, secretId, keyVaultResolver } = await createFakeWithKeys();
      const keyVaultSchemeSecretId = secretId.replace('https://', 'keyvault://');
      const keyVaultSchemeSecretIdWithTag = secretId.replace('https://', 'keyvault://tag1@');
      const config = {
        taggedProperty: keyVaultSchemeSecretIdWithTag,
        kvProperty: keyVaultSchemeSecretId,
      };
      console.dir(config);
      await keyVaultResolver.getObjectSecrets(config);
      expect(config.kvProperty).toEqual('big secret');
      expect(config.taggedProperty).toEqual('p1');
    });

    it('keyvault:// tag properties return undefined if missing', async () => {
      const { keyVaultClient, secretId, keyVaultResolver } = await createFakeWithKeys();
      const keyVaultSchemeSecretIdWithTag = secretId.replace('https://', 'keyvault://undefinedtagthing@');
      const config = {
        taggedProperty: keyVaultSchemeSecretIdWithTag,
      };
      await keyVaultResolver.getObjectSecrets(config);
      expect(config.taggedProperty).toBeUndefined();
    });

    it('URL values passthrough', async () => {
      const { keyVaultClient, secretId, keyVaultResolver } = await createFakeWithKeys();
      const config = {
        a: secretId,
      };
      await keyVaultResolver.getObjectSecrets(config);
      expect(config.a).toEqual(secretId);
    });

    it('keyvault:// on an invalid secret stops processing', async () => {
      const { keyVaultResolver } = await createFakeWithKeys();
      const config = {
        a: 'keyvault://invalid/secrets/hello/1',
      };
      await expect(keyVaultResolver.getObjectSecrets(config)).rejects.toBeTruthy();
    });
  });
});
