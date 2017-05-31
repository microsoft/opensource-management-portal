//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

class LinkManager {
  constructor(operations, userContext) {
    this.context = userContext;
    this.id = userContext.id;

    const privates = _private(this);
    privates.operations = operations;
  }

  getCachedLink(options, callback) {
    if (!callback && typeof(options) === 'function') {
      callback = options;
      options = null;
    }
    options = options || {};
    const operations = _private(this).operations;
    operations.graphManager.getCachedLink(this.id, options, callback);
  }
}

module.exports = LinkManager;

const privateSymbol = Symbol();
function _private(self) {
  if (self[privateSymbol] === undefined) {
    self[privateSymbol] = {};
  }
  return self[privateSymbol];
}
