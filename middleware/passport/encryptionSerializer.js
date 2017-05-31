//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';
/*eslint no-console: ["error", { allow: ["warn"] }] */

const async = require('async');
const encryption = require('../../lib/encryption');
const utils = require('../../utils');

const userEncryptedEntities = {
  azure: new Set(),
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
    if (properties[key] === undefined || properties[key] === null) {
      continue;
    }
    if (typeof properties[key] === 'object') {
      console.warn(`The property ${key} is an object. To help with diagnosing the underlying area with the problem, here is the current value of the object:`);
      console.warn(properties[key]);
      return new Error(`Session property ${key} is an object.`);
    }
  }
}

function serializeEntity(options, entityName, entity, callback) {
  const config = options.config;
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
  const keyResolver = options.keyResolver;
  if (keyResolver === undefined) {
    return callback(new Error('A key resolver must be supplied to use encryption.'));
  }
  const encryptionOptions = {
    keyEncryptionKeyId: config.session.encryptionKeyId,
    keyResolver: keyResolver,
    encryptedPropertyNames: userEncryptedEntities[entityName],
    binaryProperties: 'base64',
  };
  encryption.encryptEntity(partitionKey, rowKey, entity, encryptionOptions, (encryptError, encryptedEntity) => {
    if (encryptError) {
      return callback(utils.wrapError(encryptError, 'There was a problem with the security subsystem starting your session.'));
    }
    callback(null, encryptedEntity);
  });
}

function deserializeEntity(options, entityName, entity, callback) {
  const partitionKey = entityName;
  const idPropertyName = userEntityId[entityName];
  if (idPropertyName === undefined) {
    return callback(new Error('The entity type is not configured properly.'));
  }
  const rowKey = entity[idPropertyName];
  if (rowKey === undefined) {
    return callback(new Error('The unique identifier for the user entity was not available.'));
  }
  const keyResolver = options.keyResolver;
  if (keyResolver === undefined) {
    return callback(new Error('A key resolver must be supplied to use encryption.'));
  }
  const encryptionOptions = {
    keyResolver: keyResolver,
    binaryProperties: 'base64',
  };
  encryption.decryptEntity(partitionKey, rowKey, entity, encryptionOptions, (encryptError, decryptedEntity) => {
    if (encryptError) {
      const userError = utils.wrapError(encryptError, 'There was a problem with the security subsystem retrieving your session.');
      userError.forceSignOut = true;
      return callback(userError);
    }
    callback(null, decryptedEntity);
  });
}

function serialize(options, user, done) {
  const tasks = {};
  for (const entityName in userEncryptedEntities) {
    const entityPresent = user[entityName];
    if (entityPresent !== undefined) {
      const entityOriginalValue = entityPresent;
      delete user[entityName];
      tasks[entityName] = serializeEntity.bind(null, options, entityName, entityOriginalValue);
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

function deserialize(options, user, done) {
  const tasks = {};
  let u = {};
  for (const entityName in user) {
    if (userEncryptedEntities[entityName] !== undefined) {
      let entityValue = user[entityName];
      tasks[entityName] = deserializeEntity.bind(null, options, entityName, entityValue);
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

function initialize(options, app, serializerInstance) {
  app._sessionSerializer = serializerInstance;
}

module.exports = {
  serialize: serialize,
  deserialize: deserialize,
  initialize: initialize,
};
