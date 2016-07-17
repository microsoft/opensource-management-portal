//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

const uuid = require('node-uuid');

// ----------------------------------------------------------------------------
// Generate a correlation ID
// ----------------------------------------------------------------------------
module.exports = function (req, res, next) {
  req.correlationId = uuid.v4();
  next();
};
