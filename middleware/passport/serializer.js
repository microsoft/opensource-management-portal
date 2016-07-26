//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

const serializer = {};

function ensureSerializer(config) {
  const serializerKey = config.authentication.encrypt;
  if (!serializer[serializerKey]) {
    serializer[serializerKey] = require(serializerKey === true ? './encryptionSerializer' : './plainSerializer');
  }
  return serializer[serializerKey];
}

function createSerialize(config) {
  return ensureSerializer(config).serialize.bind(null, config);
}

function createDeserialize(config) {
  return ensureSerializer(config).deserialize.bind(null, config);
}

function initialize(config, app) {
  const initializer = ensureSerializer(config).initialize;
  if (initializer) {
    // Allow an opportunity to provide a warning or connect a route
    initializer(app);
  }
}

module.exports = {
  initialize: initialize,
  serialize: createSerialize,
  deserialize: createDeserialize,
};
