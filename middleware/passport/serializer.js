//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

const serializer = {};

function ensureSerializer(config) {
  const serializerKey = config.session.encryption;
  if (!serializer[serializerKey]) {
    serializer[serializerKey] = require(serializerKey === true ? './encryptionSerializer' : './plainSerializer');
  }
  return serializer[serializerKey];
}

function createSerialize(options) {
  return ensureSerializer(options.config).serialize.bind(null, options);
}

function createDeserialize(options) {
  return ensureSerializer(options.config).deserialize.bind(null, options);
}

function initialize(options, app) {
  const serializerInstance = ensureSerializer(options.config);
  const initializer = serializerInstance.initialize;
  if (initializer) {
    // Allow an opportunity to provide a warning or connect a route
    initializer(options, app, serializerInstance);
  }
}

module.exports = {
  initialize: initialize,
  serialize: createSerialize,
  deserialize: createDeserialize,
};
