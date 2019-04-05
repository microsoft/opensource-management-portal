//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

const hsts = require('hsts');

module.exports = hsts({
  maxAge: 10886400000,     // Must be at least 18 weeks to be approved
  includeSubDomains: true, // Must be enabled to be approved
  preload: true,
});
