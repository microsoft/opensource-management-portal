//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

const languageMap = require('language-map');

// Wrapper designed to make it easier for us to use language colors
// with Pug, similar to a mixin
module.exports = function (name) {
  const language = languageMap[name];
  if (language) {
    return language.color;
  }
};
