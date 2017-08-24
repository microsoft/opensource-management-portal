//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

/*eslint no-console: ["error", { allow: ["warn"] }] */

const _ = require('lodash');

function assignKnownFields(self, entity, type, primaryProperties, secondaryProperties) {
  const copy = Object.assign({}, entity);

  const directSet = _.pick(copy, primaryProperties);
  _.keys(directSet).forEach(key => { delete copy[key]; });
  Object.assign(self, directSet);

  if (secondaryProperties) {
    const otherSet = _.pick(copy, secondaryProperties);
    _.keys(otherSet).forEach(key => { delete copy[key]; });
    if (!self.otherFields) {
      self.otherFields = {};
    }
    Object.assign(self.otherFields, otherSet);
  }

  let remainingKeys = _.keys(copy);
  if (remainingKeys.length > 0) {
    if (!self.extraFields) {
      self.extraFields = {};
    }
    remainingKeys.forEach(key => {
      self.extraFields[key] = copy[key];
    });
  }
}

function createInstancesCallback(self, createMethod, callback) {
  return function (error, entities) {
    if (error) {
      return callback(error);
    }
    let wrap = createMethod.bind(self);
    callback(null, _.map(entities, wrap));
  };
}

module.exports.assignKnownFields = assignKnownFields;
module.exports.createInstancesCallback = createInstancesCallback;

