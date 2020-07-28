//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

function serialize(config, user, done) {
  done(null, user);
}

function deserialize(config, user, done) {
  done(null, user);
}

function i() {
  console.warn('Plain text session tokens are in use. Not recommended for production.');
}

module.exports = {
  serialize: serialize,
  deserialize: deserialize,
  initialize: i,
};
