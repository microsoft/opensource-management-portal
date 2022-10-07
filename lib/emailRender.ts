//
// Copyright (c) Microsoft.
//

import path from 'path';
import pug from 'pug';

export default function RenderHtmlMail(
  basedir: string,
  viewName: string,
  options,
  config
): Promise<string> {
  return new Promise((resolve, reject) => {
    return renderMailHtml(basedir, viewName, options, config, (error, html) => {
      return error ? reject(error) : resolve(html);
    });
  });
}

function renderMailHtml(
  basedir: string,
  viewName: string,
  options,
  config,
  callback
) {
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
    options.config = config;
    html = pug.renderFile(view, options);
  } catch (renderError) {
    return callback(renderError);
  }
  return callback(null, html);
}
