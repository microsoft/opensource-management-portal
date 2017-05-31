//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

const pkg = require('../package.json');

const logging = {
  errors: 'env://SITE_SKIP_ERRORS?default=0&trueIf=0',
  version: pkg.version,
};

module.exports = logging;
