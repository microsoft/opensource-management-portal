//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

module.exports = function createMailAddressProvider() {
  return {
    getAddressFromUpn: (upn, callback) => {
      return callback(null, upn);
    },
  };
};
