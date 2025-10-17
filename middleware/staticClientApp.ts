//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import Debug from 'debug';
import fs from 'fs';

import { FrontendMode, getFrontendMode, getStaticReactClientFolder } from '../lib/transitional.js';
import appPackage from '../package.json' with { type: 'json' };

import type { IReposApplication, SiteConfiguration } from '../interfaces/index.js';
import type { ExpressWithStatic } from './types.js';

const STATIC_REACT_BUILD_FOLDER_KEY = 'static-react-folder';
const STATIC_REACT_FLIGHTING_PACKAGE_NAME_KEY = 'static-react-flight-package-name';

const staticClientFlightingPackageName = appPackage[STATIC_REACT_FLIGHTING_PACKAGE_NAME_KEY];
const debug = Debug.debug('startup');

export type RuntimeConfigurationClient = {
  packageName?: string;
  packageVersion?: string;
  flighting?: {
    packageName: string;
    packageVersion: string;
  };
};

export type RootRuntimeConfigurationClient = {
  client?: RuntimeConfigurationClient;
};

export async function serveFrontendAppWithAssets(
  app: IReposApplication,
  express: ExpressWithStatic,
  config: SiteConfiguration
) {
  const clientRuntimeConfiguration: RuntimeConfigurationClient = {};
  app.runtimeConfiguration.client = clientRuntimeConfiguration;

  // Serve/host the static client app from the location reported by the private
  // NPM module for the React app. Assumes that the inclusion of the package
  // returns the path to host.
  const frontendMode = getFrontendMode();
  const staticClientDetails = getStaticReactClientFolder();
  if (!staticClientDetails && (frontendMode === FrontendMode.Skip || frontendMode === FrontendMode.Proxied)) {
    debug(`The frontend mode is ${frontendMode}. No client will be hosted.`);
    return;
  }
  if (!staticClientDetails) {
    debug(
      `package.json is not configured with a package in the property name ${STATIC_REACT_BUILD_FOLDER_KEY} or not the proper process env name. No client will be hosted.`
    );
    return;
  }
  try {
    if (!staticClientDetails.hostingRoot) {
      throw new Error(`The package ${staticClientDetails} does not have a hostingRoot property`);
    }
    // previously, require'd here;
    const clientPackage = staticClientDetails.package || {};
    debug(`Hosting React client from ${staticClientDetails.hostingRoot}`);
    app.use(
      '/',
      express.static(staticClientDetails.hostingRoot, {
        index: false,
        redirect: false,
      })
    );
    clientRuntimeConfiguration.packageName = staticClientDetails?.package?.name;
    clientRuntimeConfiguration.packageVersion = (clientPackage as any)?.version;
  } catch (hostClientError) {
    console.error(`The React client could not be loaded via package ${staticClientDetails}`);
    throw hostClientError;
  }

  // Host a secondary flight build
  if (config?.client?.flighting?.enabled === true && staticClientFlightingPackageName) {
    try {
      const clientDistPath = await import(staticClientFlightingPackageName);
      if (typeof clientDistPath !== 'string') {
        throw new Error(
          `The return value of the package ${staticClientFlightingPackageName} must be a string/path`
        );
      }
      const clientPackagePath = `${staticClientFlightingPackageName}/package.json`;
      const raw = fs.readFileSync(clientPackagePath, 'utf8');
      const clientPackage = JSON.parse(raw);
      debug(`Hosting flighting React client version ${clientPackage.version} from ${clientDistPath}`);
      app.use('/', express.static(clientDistPath));
      clientRuntimeConfiguration.flighting = {
        packageName: staticClientFlightingPackageName,
        packageVersion: clientPackage.version,
      };
    } catch (hostClientError) {
      console.error(`The flighting React client could not be loaded via package ${staticClientDetails}`);
      throw hostClientError;
    }
  }
}
