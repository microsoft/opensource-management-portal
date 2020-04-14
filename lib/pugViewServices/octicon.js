//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

const octicons = require('octicons');

// Wrapper designed to make it easier for us to use octicons with Pug
// similar to a mixin
module.exports = function (name, optionalWidth, classes, optionalAria) {
  const icon = octicons[name];
  if (!icon || typeof (icon.toSVG) !== 'function') {
    throw new Error(`Missing octicon ${name}`);
  }
  const options = {};
  if (optionalWidth) {
    options.width = optionalWidth;
  }
  if (optionalAria) {
    options['aria-label'] = optionalAria;
  }
  if (classes) {
    options.class = classes;
  }
  return icon.toSVG(options);
};
