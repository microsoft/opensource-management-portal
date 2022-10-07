//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import crypto from 'crypto';
import { randomUUID } from 'crypto';

import {
  decryptEntityAsync,
  encryptEntityAsync,
  IEncryptionOptions,
} from '../lib/encryption';

const standardTimeout = 5000;

function generate32bitKey(callback) {
  crypto.randomBytes(32, callback);
}

describe('encryption', () => {
  describe('encryptEntity', () => {
    it(
      'unencrypted entities can be processed',
      (done) => {
        expect.assertions(1);
        let dynamicKeyId = randomUUID();
        generate32bitKey((error, key) => {
          let keyEncryptionKeys = {
            [dynamicKeyId]: key,
          };
          let sampleEncryptionOptions: IEncryptionOptions = {
            keyEncryptionKeyId: dynamicKeyId,
            encryptedPropertyNames: new Set(['secret']),
            keyEncryptionKeys: keyEncryptionKeys,
          };
          let entity = {
            hello: 'world',
            notSecret: 'this is not a secret',
            secret: 'this is a secret',
            superSecret: 'the password is password',
          };
          let partitionKey = 'partition' + randomUUID();
          let rowKey = 'row' + randomUUID();
          const roundtripEntity = decryptEntityAsync(
            partitionKey,
            rowKey,
            entity,
            sampleEncryptionOptions
          )
            .then((ok) => {
              expect(entity).toEqual(roundtripEntity);
            })
            .catch((err) => {
              done();
            });
        });
      },
      standardTimeout
    ),
      it(
        'should have encryption metadata',
        (done) => {
          expect.assertions(4);
          const dynamicKeyId = randomUUID();
          generate32bitKey((error, key) => {
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
            encryptEntityAsync(
              partitionKey,
              rowKey,
              secretEntity,
              sampleEncryptionOptions
            )
              .then((encryptedEntity) => {
                expect(error).toBeFalsy();
                expect(encryptedEntity).toBeDefined();
                expect(
                  encryptedEntity['_ClientEncryptionMetadata1']
                ).toBeDefined();
                expect(
                  encryptedEntity['_ClientEncryptionMetadata2']
                ).toBeDefined();
                done();
              })
              .catch(() => {
                done();
              });
          });
        },
        standardTimeout
      ),
      it(
        'should be able to decrypt itself',
        (done) => {
          expect.assertions(3);
          let dynamicKeyId = randomUUID();
          generate32bitKey((error, key) => {
            let keyEncryptionKeys = {
              [dynamicKeyId]: key,
            };
            let sampleEncryptionOptions: IEncryptionOptions = {
              keyEncryptionKeyId: dynamicKeyId,
              encryptedPropertyNames: new Set(['secret', 'superSecret']),
              keyEncryptionKeys: keyEncryptionKeys,
            };
            let secretEntity = {
              hello: 'world',
              notSecret: 'this is not a secret',
              secret: 'this is a secret',
              superSecret: 'the password is password',
            };
            let partitionKey = 'partition' + randomUUID();
            let rowKey = 'row' + randomUUID();
            encryptEntityAsync(
              partitionKey,
              rowKey,
              secretEntity,
              sampleEncryptionOptions
            )
              .then((encryptedEntity) => {
                expect(error).toBeFalsy();
                expect(encryptedEntity).not.toEqual(secretEntity);
                decryptEntityAsync(
                  partitionKey,
                  rowKey,
                  encryptedEntity as any,
                  sampleEncryptionOptions
                )
                  .then((roundtripEntity) => {
                    expect(roundtripEntity).toEqual(secretEntity);
                    done();
                  })
                  .catch((err) => done(err));
              })
              .catch((err) => done(err));
          });
        },
        standardTimeout
      );
  });
});
