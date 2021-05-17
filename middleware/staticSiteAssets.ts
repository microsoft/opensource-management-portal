//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

/*eslint no-console: ["error", { allow: ["log", "error", "warn", "dir"] }] */

import appPackage from '../package.json';

const debug = require('debug')('startup');

import favicon from 'serve-favicon';
import path from 'path';

const defaultPublicAssetsPackageName = '../default-assets-package/';
const staticAssetspackageName = appPackage['static-site-assets-package-name'] || defaultPublicAssetsPackageName;

let ospoAssetsDistPath = null;
try {
  ospoAssetsDistPath = require(staticAssetspackageName);
} catch(error) {
  // To support test scenarios and also TypeScript deployment in containers,
  // when a non-package but path is being used, try the local inplace path
  // before attempting to move up a parent. Only when the default is used.
  if (staticAssetspackageName === defaultPublicAssetsPackageName) {
    ospoAssetsDistPath = require('../' + staticAssetspackageName);
  }
}
const ospoAssetsPackage = require(`${staticAssetspackageName}/package.json`);

export function StaticSiteAssets(app, express) {
  // Serve/host the static site assets from our private NPM

  debug(`Hosting site assets version ${ospoAssetsPackage.version} from ${ospoAssetsDistPath} on path '/'`);
  app.use(express.static(ospoAssetsDistPath));
};

export function StaticSiteFavIcon(app) {
  try {
    app.use(favicon(path.join(ospoAssetsDistPath, 'favicon.ico')));
  } catch (nofavicon) {
    console.error(`The static site assets in "${ospoAssetsDistPath}" does not include a favicon. You may need to run 'npm install' in the package folder first.`);
    throw nofavicon;
  }
}
