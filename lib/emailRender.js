//
// Copyright (c) Microsoft. All rights reserved.
//

'use strict';

const path = require('path');
const pug = require('pug');

module.exports.render = function (basedir, viewName, options, callback) {
  options = options || {};
  if (!viewName) {
    viewName = 'email';
  }
  if (!options.view) {
    options.view = viewName;
  }
  let html = null;
  try {
    const view = path.join(basedir, `views/email/${viewName}.pug`);
    options.pretty = true;
    options.basedir = basedir;
    html = pug.renderFile(view, options);
  } catch (renderError) {
    return callback(renderError);
  }
  return callback(null, html);
};
