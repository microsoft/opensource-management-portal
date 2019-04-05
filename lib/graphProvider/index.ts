//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

const providers = [
  'microsoftGraphProvider',
];

module.exports = function createGraphProviderInstance(config, callback) {
  const graphConfig = config.graph;
  if (!graphConfig) {
    return callback(new Error('No graph config.'));
  }
  const provider = graphConfig.provider;
  if (!provider) {
    return callback(new Error('No graph provider set in the graph config.'));
  }
  let found = false;
  providers.forEach((supportedProvider) => {
    if (supportedProvider === provider) {
      found = true;
      let providerInstance = null;
      try {
        providerInstance = require(`./${supportedProvider}`)(graphConfig);
      }
      catch (createError) {
        return callback(createError);
      }
      return callback(null, providerInstance);
    }
  });
  if (found === false) {
    return callback(new Error(`The graph provider "${provider}" is not implemented or configured at this time.`));
  }
};
