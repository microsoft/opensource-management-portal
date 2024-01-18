//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import Debug from 'debug';
const debug = Debug.debug('startup');

import path from 'path';

import type { ApplicationProfile, IReposApplication, SiteConfiguration } from '../interfaces';

export default async function initializeAlternateApps(
  config: SiteConfiguration,
  app: IReposApplication,
  appName: string
): Promise<ApplicationProfile> {
  const appPath = path.resolve(path.join(__dirname, '..', appName, '/'));
  debug(`Alternate app requested: name=${appName}, path=${appPath}`);
  try {
    let setupApp = require(appPath);
    // support modern imports
    if (typeof setupApp !== 'function' && setupApp.default) {
      setupApp = setupApp.default;
    } else if (typeof setupApp !== 'function') {
      throw new Error(`Could not prepare default import for alternate app name=${appName}, path=${appPath}`);
    }
    return await setupApp(config, app);
  } catch (loadAlternateAppError) {
    console.log(`Loading error: ${loadAlternateAppError}`);
    throw loadAlternateAppError;
  }
}
