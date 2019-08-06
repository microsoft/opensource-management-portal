//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

// NOTE: Technically this file should be separate from the GitHub library

import Q from 'q';
import { CompositeApiContext } from './composite';
import { createCallbackFlattenData } from './core';
import { ILinkProvider } from '../linkProviders/postgres/postgresLinkProvider';
import { linkSync } from 'fs';

function createLinkMethods(libraryContext) {
  return {
    getCachedLinks: function getCachedLinks(getPromisedLinks, options, cacheOptions, callback) {
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
      apiContext.libraryContext = libraryContext;
      if (cacheOptions.backgroundRefresh) {
        apiContext.backgroundRefresh = true;
      }
      const compositeEngine = libraryContext.compositeEngine;
      const wrappingCallback = createCallbackFlattenData(callback);
      compositeEngine.execute(apiContext).then(ok => {
        return wrappingCallback(null, ok);
      }, wrappingCallback);
      // return core.execute(apiContext, innerCallback);
    },
  };
}

module.exports = createLinkMethods;
