//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

module.exports = function (graphApi) {
  const environment = graphApi.environment.get('NODE_ENV');
  return {
    environment,
    isProduction: environment === 'production',
    version: process.version,
  };
};
