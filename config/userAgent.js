//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

const pkg = require('../package.json');

function set(config) {
  config.userAgent = 'env://REPOS_USER_AGENT';
}

set.evaluate = (config) => {
  if (!config.userAgent) {
    config.userAgent = `${pkg.name}/${pkg.version}`;
  }
};

module.exports = set;
