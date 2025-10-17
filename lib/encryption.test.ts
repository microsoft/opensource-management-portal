//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { describe, expect, it } from 'vitest';

import crypto from 'crypto';
import { randomUUID } from 'crypto';

import { decryptEntityAsync, encryptEntityAsync, IEncryptionOptions } from './encryption.js';

const standardTimeout = 5000;

async function generate32bitKeyAsync() {
  return new Promise((resolve, reject) => {
    crypto.randomBytes(32, (error, key) => {
      if (error) {
        reject(error);
      } else {
        resolve(key);
      }
    });
  });
}

describe('encryption', () => {
  describe('encryptEntity', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    (it(
      'unencrypted entities can be processed',
      async () => {
        expect.assertions(1);
        const dynamicKeyId = randomUUID();
        const key = await generate32bitKeyAsync();
        const keyEncryptionKeys = {
          [dynamicKeyId]: key,
        };
        const sampleEncryptionOptions: IEncryptionOptions = {
          keyEncryptionKeyId: dynamicKeyId,
          encryptedPropertyNames: new Set(['secret']),
          keyEncryptionKeys: keyEncryptionKeys,
        };
        const entity = {
          hello: 'world',
          notSecret: 'this is not a secret',
          secret: 'this is a secret',
          superSecret: 'the password is password',
        };
        const partitionKey = 'partition' + randomUUID();
        const rowKey = 'row' + randomUUID();
        const roundtripEntity = await decryptEntityAsync(
          partitionKey,
          rowKey,
          entity,
          sampleEncryptionOptions
        );
        expect(entity).toEqual(roundtripEntity);
      },
      standardTimeout
    ),
      it(
        'should have encryption metadata',
        async () => {
          expect.assertions(3);
          const dynamicKeyId = randomUUID();
          const key = await generate32bitKeyAsync();
          const keyEncryptionKeys = {
            [dynamicKeyId]: key,
          };
          const sampleEncryptionOptions: IEncryptionOptions = {
            keyEncryptionKeyId: dynamicKeyId,
            encryptedPropertyNames: new Set(['secret', 'superSecret']),
            keyEncryptionKeys,
          };
          const secretEntity = {
            hello: 'world',
            notSecret: 'this is not a secret',
            secret: 'this is a secret',
            superSecret: 'the password is password',
          };
          const partitionKey = 'partition' + randomUUID();
          const rowKey = 'row' + randomUUID();
          const encryptedEntity = await encryptEntityAsync(
            partitionKey,
            rowKey,
            secretEntity,
            sampleEncryptionOptions
          );
          expect(encryptedEntity).toBeDefined();
          expect(encryptedEntity['_ClientEncryptionMetadata1']).toBeDefined();
          expect(encryptedEntity['_ClientEncryptionMetadata2']).toBeDefined();
        },
        standardTimeout
      ),
      it(
        'should be able to decrypt itself',
        async () => {
          expect.assertions(2);
          const dynamicKeyId = randomUUID();
          const key = await generate32bitKeyAsync();
          const keyEncryptionKeys = {
            [dynamicKeyId]: key,
          };
          const sampleEncryptionOptions: IEncryptionOptions = {
            keyEncryptionKeyId: dynamicKeyId,
            encryptedPropertyNames: new Set(['secret', 'superSecret']),
            keyEncryptionKeys: keyEncryptionKeys,
          };
          const secretEntity = {
            hello: 'world',
            notSecret: 'this is not a secret',
            secret: 'this is a secret',
            superSecret: 'the password is password',
          };
          const partitionKey = 'partition' + randomUUID();
          const rowKey = 'row' + randomUUID();
          const encryptedEntity = await encryptEntityAsync(
            partitionKey,
            rowKey,
            secretEntity,
            sampleEncryptionOptions
          );
          expect(encryptedEntity).not.toEqual(secretEntity);
          const roundtripEntity = await decryptEntityAsync(
            partitionKey,
            rowKey,
            encryptedEntity as any,
            sampleEncryptionOptions
          );
          expect(roundtripEntity).toEqual(secretEntity);
        },
        standardTimeout
      ));
  });
});
