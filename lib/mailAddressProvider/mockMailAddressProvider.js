//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

module.exports = function createMailAddressProvider() {
  const upnToEmails = new Map();
  return {
    getAddressFromUpn: (upn, callback) => {
      if (upnToEmails.has(upn)) {
        return callback(null, upnToEmails.get(upn));
      }
      callback(new Error(`No e-mail address known for "${upn}".`));
    },
    // testability:
    getUpnToEmails: function () {
      return upnToEmails;
    }
  };
};
