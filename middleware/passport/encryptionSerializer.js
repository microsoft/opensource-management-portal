//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

const async = require('async');
const encryption = require('../../lib/encryption');
const utils = require('../../utils');

const userEncryptedEntities = {
  azure: new Set(['accessToken', 'refreshToken']),
  github: new Set(['accessToken']),
  githubIncreasedScope: new Set(['accessToken']),
};

const userEntityId = {
  github: 'id',
  githubIncreasedScope: 'id',
  azure: 'oid',
};

function validateNoRichProperties(properties) {
  for (const key in properties) {
    if (typeof properties[key] === 'object') {
      return new Error(`Session property ${key} is an object.`);
    }
  }
}

function keyResolver(config, id, callback) {
  const key = id === config.authentication.keyId ? config.authentication.key : null;
  return callback(null, key);
}

function serializeEntity(config, entityName, entity, callback) {
  const partitionKey = entityName;
  const idPropertyName = userEntityId[entityName];
  const rowKey = entity[idPropertyName];
  const richObjectError = validateNoRichProperties(entity);
  if (richObjectError !== undefined) {
    return callback(richObjectError);
  }
  if (rowKey === undefined) {
    return callback(new Error('The unique identifier for the user entity was not available.'));
  }
  const options = {
    keyEncryptionKeyId: config.authentication.keyId,
    keyResolver: keyResolver.bind(null, config),
    encryptedPropertyNames: userEncryptedEntities[entityName],
    binaryProperties: 'base64',
  };
  encryption.encryptEntity(partitionKey, rowKey, entity, options, (encryptError, encryptedEntity) => {
    if (encryptError) {
      return callback(utils.wrapError(encryptError, 'There was a problem with the security subsystem starting your session.'));
    }
    callback(null, encryptedEntity);
  });
}

function deserializeEntity(config, entityName, entity, callback) {
  const partitionKey = entityName;
  const idPropertyName = userEntityId[entityName];
  if (idPropertyName === undefined) {
    return callback(new Error('The entity type is not configured properly.'));
  }
  const rowKey = entity[idPropertyName];
  if (rowKey === undefined) {
    return callback(new Error('The unique identifier for the user entity was not available.'));
  }
  const options = {
    keyEncryptionKeyId: config.authentication.keyId,
    keyResolver: keyResolver.bind(null, config),
    binaryProperties: 'base64',
  };
  encryption.decryptEntity(partitionKey, rowKey, entity, options, (encryptError, decryptedEntity) => {
    if (encryptError) {
      return callback(utils.wrapError(encryptError, 'There was a problem with the security subsystem retrieving your session.'));
    }
    callback(null, decryptedEntity);
  });
}

function serialize(config, user, done) {
  const tasks = {};
  for (const entityName in userEncryptedEntities) {
    const entityPresent = user[entityName];
    if (entityPresent !== undefined) {
      const entityOriginalValue = entityPresent;
      delete user[entityName];
      tasks[entityName] = serializeEntity.bind(null, config, entityName, entityOriginalValue);
    }
  }
  async.parallel(tasks, (error, results) => {
    if (error) {
      return done(error);
    }
    for (const result in results) {
      user[result] = results[result];
    }
    return done(null, user);
  });
}

function deserialize(config, user, done) {
  const tasks = {};
  let u = {};
  for (const entityName in user) {
    if (userEncryptedEntities[entityName] !== undefined) {
      let entityValue = user[entityName];
      tasks[entityName] = deserializeEntity.bind(null, config, entityName, entityValue);
    }
  }
  async.parallel(tasks, (error, results) => {
    if (error) {
      return done(error);
    }
    for (const result in results) {
      u[result] = results[result];
    }
    for (const unencryptedEntity in user) {
      if (userEncryptedEntities[unencryptedEntity] === undefined) {
        u[unencryptedEntity] = user[unencryptedEntity];
      }

    }
    return done(null, u);
  });
}

function initialize(config, app, serializerInstance) {
  app._sessionSerializer = serializerInstance;
}

module.exports = {
  serialize: serialize,
  deserialize: deserialize,
  initialize: initialize,
};
