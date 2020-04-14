//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

const sslify = require('express-sslify');

module.exports = sslify.HTTPS(
  { trustAzureHeader: true }
);
