//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

module.exports = function jsonError(error, statusCode) {
  if (error && error.length && error.indexOf && !error.message) {
    error = new Error(error);
  }
  if (!error) {
    error = new Error('An error occurred.');
  }
  error.json = true;
  if (statusCode) {
    error.statusCode = statusCode;
  }
  return error;
};
