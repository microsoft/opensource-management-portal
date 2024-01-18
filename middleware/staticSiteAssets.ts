//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import appPackage from '../package.json';
import appRoot from 'app-root-path';

import Debug from 'debug';
const debug = Debug.debug('startup');

import favicon from 'serve-favicon';
import path from 'path';

import { CreateError } from '../lib/transitional';

const appRootPath = appRoot.toString();

const defaultPublicAssetsPackageFolder = 'default-assets-package/';
const staticAssetsPackageName =
  appPackage['static-site-assets-package-name'] || defaultPublicAssetsPackageFolder;
const isDefaultPath = staticAssetsPackageName === defaultPublicAssetsPackageFolder;

const ospoAssetsDistPath =
  false === isDefaultPath
    ? require(staticAssetsPackageName)
    : require(path.join(appRootPath, defaultPublicAssetsPackageFolder));
const ospoAssetsPackage =
  false === isDefaultPath
    ? require(`${staticAssetsPackageName}/package.json`)
    : require(path.join(appRootPath, defaultPublicAssetsPackageFolder, 'package.json'));

export function StaticSiteAssets(app, express) {
  // Serve/host the static site assets from our private NPM

  debug(`hosting site assets version ${ospoAssetsPackage.version} from ${ospoAssetsDistPath} on path '/'`);
  app.use(express.static(ospoAssetsDistPath));
}

export function StaticSiteFavIcon(app) {
  const faviconPath = path.join(ospoAssetsDistPath, 'favicon.ico');
  try {
    app.use(favicon(faviconPath));
  } catch (nofavicon) {
    if (nofavicon?.code === 'ENOENT') {
      console.error(
        `There is no favorite icon in the static site assets path, "${ospoAssetsDistPath}".\nIf the static assets require a build, you may need to run 'npm install' in the package folder first.`
      );
      throw CreateError.NotFound(`No favicon.ico in ${ospoAssetsDistPath}`, nofavicon);
    } else {
      throw nofavicon;
    }
  }
}
