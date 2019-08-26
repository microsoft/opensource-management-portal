//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

// NOTE: Technically this file should be separate from the GitHub library

import { CompositeApiContext } from './composite';
import { createCallbackFlattenData } from './core';
import { ILibraryContext } from '.';

export class LinkMethods {
  private libraryContext: ILibraryContext;

  constructor(libraryContext: ILibraryContext) {
    this.libraryContext = libraryContext;
  }

  getCachedLinks(getPromisedLinks, options, cacheOptions, callback) {
    if (callback === undefined && typeof (cacheOptions) === 'function') {
      callback = cacheOptions;
      cacheOptions = {};
    }
    const apiName = 'all';
    const method = getPromisedLinks;
    options = options || {
      includeNames: true,
      includeId: true,
      includeServiceAccounts: true,
    };
    options.apiTypePrefix = 'links.col#';
    const apiContext = new CompositeApiContext(apiName, method, options);
    apiContext.maxAgeSeconds = cacheOptions.maxAgeSeconds || 300;
    // apiContext.token = token;
    apiContext.libraryContext = this.libraryContext;
    if (cacheOptions.backgroundRefresh) {
      apiContext.backgroundRefresh = true;
    }
    const compositeEngine = this.libraryContext.compositeEngine;
    const wrappingCallback = createCallbackFlattenData(callback);
    compositeEngine.execute(apiContext).then(ok => {
      return wrappingCallback(null, ok);
    }, wrappingCallback as any);
    // return core.execute(apiContext, innerCallback);
  }
}
