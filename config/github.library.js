//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

const pkg = require('../package.json');

const githubLibrary = {
  userAgent: `${pkg.name}/${pkg.version}`,
};

module.exports = githubLibrary;
