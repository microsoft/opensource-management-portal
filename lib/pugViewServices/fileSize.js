//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

const fileSize = require('file-size');

module.exports = function (bytes) {
  return fileSize(bytes).human();
};
