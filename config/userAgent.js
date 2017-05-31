//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

function set(config) {
  config.userAgent = 'env://REPOS_USER_AGENT';
}

set.evaluate = (config) => {
  if (!config.userAgent) {
    const pkg = require('../package.json');
    config.userAgent = `${pkg.name}/${pkg.version}`;
  }
};

module.exports = set;
