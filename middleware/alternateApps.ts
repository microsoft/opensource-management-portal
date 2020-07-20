//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

const debug = require('debug')('startup');

import path from 'path';

import { IReposApplication } from '../app';
import { IApplicationProfile } from '../transitional';

export default async function initializeAlternateApps(config, app: IReposApplication, appName: string): Promise<IApplicationProfile> {
  const appPath = path.resolve(path.join(__dirname, '..', appName, '/'));
  debug(`Alternate app requested: name=${appName}, path=${appPath}`);
  try {
    const setupApp = require(appPath);
    return await setupApp(config, app);
  } catch (loadAlternateAppError) {
    console.log(`Loading error: ${loadAlternateAppError}`);
    throw loadAlternateAppError;
  }
}
