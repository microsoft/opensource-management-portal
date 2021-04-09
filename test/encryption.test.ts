//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import crypto from 'crypto';
import { v4 as uuidV4 } from 'uuid';

import { decryptEntity, encryptEntity } from '../lib/encryption';

const standardTimeout = 5000;

function generate32bitKey(callback) {
  crypto.randomBytes(32, callback);
}

describe('encryption', () => {
  describe('encryptEntity', () => {
    it('unencrypted entities can be processed', done => {
      expect.assertions(2);
      let dynamicKeyId = uuidV4();
      generate32bitKey((error, key) => {
        let keyEncryptionKeys = {
          [dynamicKeyId]: key,
        };
        let sampleEncryptionOptions = {
          keyEncryptionKeyId: dynamicKeyId,
          encryptedPropertyNames: ['secret'],
          keyEncryptionKeys: keyEncryptionKeys,
        };
        let entity = {
          hello: 'world',
          notSecret: 'this is not a secret',
          secret: 'this is a secret',
          superSecret: 'the password is password',
        };
        let partitionKey = 'partition' + uuidV4();
        let rowKey = 'row' + uuidV4();
        decryptEntity(partitionKey, rowKey, entity, sampleEncryptionOptions, (anotherError, roundtripEntity) => {
          expect(anotherError).toBeFalsy();
          expect(entity).toEqual(roundtripEntity);
          done();
        });
      });
    }, standardTimeout),

    it('should have encryption metadata', done => {
      expect.assertions(4);
      const dynamicKeyId = uuidV4();
      generate32bitKey((error, key) => {
        const keyEncryptionKeys = {
          [dynamicKeyId]: key,
        };
        const sampleEncryptionOptions = {
          keyEncryptionKeyId: dynamicKeyId,
          encryptedPropertyNames: ['secret', 'superSecret'],
          keyEncryptionKeys,
        };
        const secretEntity = {
          hello: 'world',
          notSecret: 'this is not a secret',
          secret: 'this is a secret',
          superSecret: 'the password is password',
        };
        const partitionKey = 'partition' + uuidV4();
        const rowKey = 'row' + uuidV4();
        encryptEntity(partitionKey, rowKey, secretEntity, sampleEncryptionOptions, (error, encryptedEntity) => {
          expect(error).toBeFalsy();
          expect(encryptedEntity).toBeDefined();
          expect(encryptedEntity['_ClientEncryptionMetadata1']).toBeDefined();
          expect(encryptedEntity['_ClientEncryptionMetadata2']).toBeDefined();
          done();
        });
      });
    }, standardTimeout),

    it('should be able to decrypt itself', done => {
      expect.assertions(4);
      let dynamicKeyId = uuidV4();
      generate32bitKey((error, key) => {
        let keyEncryptionKeys = {
          [dynamicKeyId]: key,
        };
        let sampleEncryptionOptions = {
          keyEncryptionKeyId: dynamicKeyId,
          encryptedPropertyNames: ['secret', 'superSecret'],
          keyEncryptionKeys: keyEncryptionKeys,
        };
        let secretEntity = {
          hello: 'world',
          notSecret: 'this is not a secret',
          secret: 'this is a secret',
          superSecret: 'the password is password',
        };
        let partitionKey = 'partition' + uuidV4();
        let rowKey = 'row' + uuidV4();
        encryptEntity(partitionKey, rowKey, secretEntity, sampleEncryptionOptions, (error, encryptedEntity) => {
          expect(error).toBeFalsy();
          expect(encryptEntity).not.toEqual(secretEntity);
          decryptEntity(partitionKey, rowKey, encryptedEntity, sampleEncryptionOptions, (anotherError, roundtripEntity) => {
            expect(anotherError).toBeFalsy();
            expect(roundtripEntity).toEqual(secretEntity);
            done();
          });
        });
      });
    }, standardTimeout);
  });
});
