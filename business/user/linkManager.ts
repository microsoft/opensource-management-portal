//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { Operations } from '../operations';

export default class LinkManager {
  private _context: any;
  private _operations: any;

  private _id: string;

  constructor(operations: Operations, userContext) {
    this._context = userContext;
    this._id = userContext.id;
    this._operations = operations;
  }
}
