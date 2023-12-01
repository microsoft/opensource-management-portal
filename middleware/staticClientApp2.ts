//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { hasStaticReactClientApp } from '../transitional';

import appPackage from '../package.json';

import type { IReposApplication, SiteConfiguration } from '../interfaces';

const packageVariableName = 'static-react-package-name';
const otherPackageVariableName = 'static-client-package-name';

const staticReactFlightingPackageNameKey = 'static-react-flight-package-name';
const staticClientFlightingPackageName = appPackage[staticReactFlightingPackageNameKey];

import Debug from 'debug';
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

export function StaticReactClientApp(app: IReposApplication, express, config: SiteConfiguration) {
  const clientRuntimeConfiguration: RuntimeConfigurationClient = {};
  app.runtimeConfiguration.client = clientRuntimeConfiguration;

  // Serve/host the static client app from the location reported by the private
  // NPM module for the React app. Assumes that the inclusion of the package
  // returns the path to host.
  const staticClientPackageName = hasStaticReactClientApp();
  const otherValue = appPackage[otherPackageVariableName];
  if (!staticClientPackageName) {
    if (!staticClientPackageName && !otherValue) {
      debug(
        `package.json is not configured with a package in the property name ${packageVariableName} or not the proper process env name. No additional client package will be hosted.`
      );
    }
    return;
  }
  try {
    const clientDistPath = require(staticClientPackageName);
    if (typeof clientDistPath !== 'string') {
      throw new Error(`The return value of the package ${staticClientPackageName} must be a string/path`);
    }
    const clientPackage = require(`${staticClientPackageName}/package.json`);
    debug(`Hosting React client version ${clientPackage.version} from ${clientDistPath}`);
    app.use('/', express.static(clientDistPath));
    clientRuntimeConfiguration.packageName = staticClientPackageName;
    clientRuntimeConfiguration.packageVersion = clientPackage.version;
  } catch (hostClientError) {
    console.error(`The React client could not be loaded via package ${staticClientPackageName}`);
    throw hostClientError;
  }

  // Host a secondary flight build
  if (config?.client?.flighting?.enabled === true && staticClientFlightingPackageName) {
    try {
      const clientDistPath = require(staticClientFlightingPackageName);
      if (typeof clientDistPath !== 'string') {
        throw new Error(
          `The return value of the package ${staticClientFlightingPackageName} must be a string/path`
        );
      }
      const clientPackage = require(`${staticClientFlightingPackageName}/package.json`);
      debug(`Hosting flighting React client version ${clientPackage.version} from ${clientDistPath}`);
      app.use('/', express.static(clientDistPath));
      clientRuntimeConfiguration.flighting = {
        packageName: staticClientFlightingPackageName,
        packageVersion: clientPackage.version,
      };
    } catch (hostClientError) {
      console.error(`The flighting React client could not be loaded via package ${staticClientPackageName}`);
      throw hostClientError;
    }
  }
}
