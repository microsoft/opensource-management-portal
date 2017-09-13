//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

const assert = require('chai').assert;
const crypto = require('crypto');
const uuid = require('node-uuid');

const encryption = require('../lib/encryption');

function generate32bitKey(callback) {
  crypto.randomBytes(32, callback);
}

describe('encryption', () => {
  describe('encryptEntity', () => {
    it('unencrypted entities can be processed', () => {
      let dynamicKeyId = uuid.v4();
      generate32bitKey((error, key) => {
        let keyEncryptionKeys = {};
        keyEncryptionKeys[dynamicKeyId] = key;
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
        let partitionKey = 'partition' + uuid.v4();
        let rowKey = 'row' + uuid.v4();
        encryption.decryptEntity(partitionKey, rowKey, entity, sampleEncryptionOptions, (anotherError, roundtripEntity) => {
          assert.deepEqual(entity, roundtripEntity, 'roundtripEntity is equal to entity');
        });
      });
    }),
    it('should have encryption metadata', () => {
      let dynamicKeyId = uuid.v4();
      generate32bitKey((error, key) => {
        let keyEncryptionKeys = {};
        keyEncryptionKeys[dynamicKeyId] = key;
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
        let partitionKey = 'partition' + uuid.v4();
        let rowKey = 'row' + uuid.v4();
        encryption.encryptEntity(partitionKey, rowKey, secretEntity, sampleEncryptionOptions, (error, encryptedEntity) => {
          assert.isNotOk(error, 'Should be no error back from encryptEntity');
          assert.isDefined(encryptedEntity['_ClientEncryptionMetadata1'], 'defined encryption metadata');
          assert.isDefined(encryptedEntity['_ClientEncryptionMetadata2'], 'defined encrypted keys list entry');
        });
      });
    }),
    it('should be able to decrypt itself', () => {
      let dynamicKeyId = uuid.v4();
      generate32bitKey((error, key) => {
        let keyEncryptionKeys = {};
        keyEncryptionKeys[dynamicKeyId] = key;
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
        let partitionKey = 'partition' + uuid.v4();
        let rowKey = 'row' + uuid.v4();
        encryption.encryptEntity(partitionKey, rowKey, secretEntity, sampleEncryptionOptions, (error, encryptedEntity) => {
          assert.notDeepEqual(encryptedEntity, secretEntity, 'encryptedEntity is not equal to secretEntity');
          encryption.decryptEntity(partitionKey, rowKey, encryptedEntity, sampleEncryptionOptions, (anotherError, roundtripEntity) => {
            assert.deepEqual(roundtripEntity, secretEntity, 'roundtripEntity is equal to secretEntity');
          });
        });
      });
    });
  });
});
