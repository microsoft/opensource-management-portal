//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

// NOTE: Technically this file should be separate from the GitHub library

const Q = require('q');

const composite = require('./composite');
const core = require('./core');

function getPromisedLinks(dc, options) {
  const deferred = Q.defer();
  dc.getAllEmployees(options, (error, links) => {
    if (error) {
      return deferred.reject(error);
    }
    const dataObject = {
      meta: {
        'type': 'links',
      },
      data: links,
    };
    deferred.resolve(dataObject);
  });
  return deferred.promise;
}

function createLinkMethods(libraryContext, dataClient) {
  return {
    getLinks: function getLinks(options, cacheOptions, callback) {
      if (callback === undefined && typeof (cacheOptions) === 'function') {
        callback = cacheOptions;
        cacheOptions = {};
      }
      const apiName = 'all';
      const method = getPromisedLinks.bind(null, dataClient);
      // const method = dataClient.getAllEmployees.bind(dataClient);
      options = options || {
        includeNames: true,
        includeId: true,
        includeServiceAccounts: true,
      };
      options.apiTypePrefix = 'links.col#';
      const apiContext = composite.create(apiName, method, options);
      apiContext.maxAgeSeconds = cacheOptions.maxAgeSeconds || 300;
      // apiContext.token = token;
      apiContext.libraryContext = libraryContext;
      if (cacheOptions.backgroundRefresh) {
        apiContext.backgroundRefresh = true;
      }
      return core.execute(apiContext, core.createCallbackFlattenData(callback));
    },
  };
}

module.exports = createLinkMethods;
