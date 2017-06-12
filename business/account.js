//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

const common = require('./common');
const wrapError = require('../utils').wrapError;

const githubEntityClassification = require('../data/github-entity-classification.json');
const primaryAccountProperties = githubEntityClassification.account.keep;
const secondaryAccountProperties = githubEntityClassification.account.strip;

class Account {
  constructor(entity, operations, getCentralOperationsToken) {
    common.assignKnownFields(this, entity, 'account', primaryAccountProperties, secondaryAccountProperties);

    const privates = _private(this);
    privates.operations = operations;
    privates.getCentralOperationsToken = getCentralOperationsToken;
  }

  getDetails(options, callback) {
    if (!callback && typeof(options) === 'function') {
      callback = options;
      options = null;
    }
    options = options || {};
    const self = this;
    const token = _private(this).getCentralOperationsToken();
    const operations = _private(this).operations;
    const id = this.id;
    if (!id) {
      return callback(new Error('Must provide a GitHub user ID to retrieve account information.'));
    }
    const parameters = {
      id: id,
    };
    const cacheOptions = {
      maxAgeSeconds: options.maxAgeSeconds || operations.defaults.accountDetailStaleSeconds,
    };
    if (options.backgroundRefresh !== undefined) {
      cacheOptions.backgroundRefresh = options.backgroundRefresh;
    }
    return operations.github.call(token, 'users.getById', parameters, cacheOptions, (error, entity) => {
      if (error) {
        return callback(wrapError(error, `Could not get details about account "${id}".`));
      }
      common.assignKnownFields(self, entity, 'account', primaryAccountProperties, secondaryAccountProperties);
      callback(null, entity);
    });
  }
}

module.exports = Account;

const privateSymbol = Symbol();
function _private(self) {
  if (self[privateSymbol] === undefined) {
    self[privateSymbol] = {};
  }
  return self[privateSymbol];
}
