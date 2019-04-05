import { Operations } from "../operations";

//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

export class LinkManager {
  private _context: any;
  private _operations: any;

  private _id: string;

  constructor(operations: Operations, userContext) {
    this._context = userContext;
    this._id = userContext.id;
    this._operations = operations;
  }

  getCachedLink(options, callback) {
    if (!callback && typeof(options) === 'function') {
      callback = options;
      options = null;
    }
    options = options || {};
    const operations = this._operations;
    operations.graphManager.getCachedLink(this._id, options, callback);
  }
}
