//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

let templates = null;

try {
  templates = require('../data/templates/definitions.json');
} catch (notFound) {
  /* no action required */
}

module.exports = templates;
