//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

const adalNode = require('adal-node');
const async = require('async');
const azureKeyVault = require('azure-keyvault');

function initialize(config, callback) {
  callback();
}

module.exports = {
  initialize: initialize,
}
