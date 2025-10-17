//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import appPackage from '../package.json' with { type: 'json' };

import appRoot from 'app-root-path';

import favicon from 'serve-favicon';
import path from 'path';

import { CreateError } from '../lib/transitional.js';

import type { IReposApplication } from '../interfaces/app.js';
import type { ExpressWithStatic } from './types.js';

import Debug from 'debug';
const debug = Debug.debug('startup');

export async function configureStaticAssetHosting(app: IReposApplication, express: ExpressWithStatic) {
  const appRootPath = appRoot.toString();

  const defaultPublicAssetsPackageIndex = 'default-assets-package/index.js';
  const staticAssetsPackageName =
    appPackage['static-site-assets-package-name'] || defaultPublicAssetsPackageIndex;
  const isDefaultPath = staticAssetsPackageName === defaultPublicAssetsPackageIndex;

  const importPath = isDefaultPath
    ? path.join(appRootPath, defaultPublicAssetsPackageIndex)
    : staticAssetsPackageName;
  const imported = await import(importPath);
  const ospoAssetsDistPath = (imported?.default || imported) as string;

  const serveStaticAssets = () => {
    // Serve/host the static site assets from our private NPM

    debug(`hosting site assets from ${ospoAssetsDistPath} on path '/'`);
    app.use(express.static(ospoAssetsDistPath));
  };

  const serveFavoriteIcon = () => {
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
  };

  return {
    serveStaticAssets,
    serveFavoriteIcon,
  };
}
