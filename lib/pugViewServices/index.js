//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

const fileSize = require('./fileSize');
const languageColors = require('./languageColors');
const lodash = require('./lodash');
const moment = require('./moment');
const octicon = require('./octicon');

module.exports = {
  _: lodash,
  fileSize,
  languageColor: languageColors,
  moment,
  octicon,
};
