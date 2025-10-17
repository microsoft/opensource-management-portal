//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import fs from 'fs';
import path from 'path';
import debug from 'debug';

const debugStartup = debug('startup');

// import pkg from '../package.json' with { type: 'json' };
// eslint as of 2024-04-01 does not support the assert syntax yet
import { fileURLToPath, pathToFileURL } from 'url';
const isWindows = process.platform === 'win32';

const filename = fileURLToPath(import.meta.url);
const dirname = path.dirname(filename);
const pkg = JSON.parse(fs.readFileSync(path.join(dirname, '../package.json'), 'utf8'));

const painlessConfigEnvPkgName = 'painlessConfigEnvironments';
const resourcesEnvironmentName = 'urls';
const painlessConfigEnvironmentVariableName = 'CONFIGURATION_ENVIRONMENT';

function importPathSchemeChangeIfWindows(npmName) {
  if (isWindows && path.isAbsolute(npmName)) {
    const normalized = path.normalize(npmName);
    const fileUrl = pathToFileURL(normalized);
    return fileUrl.href;
  }
  return npmName;
}

import typescriptConfig from './typescript.js';

export default async function (graphApi) {
  const environmentProvider = graphApi.environment;
  const environmentName =
    environmentProvider.get(painlessConfigEnvironmentVariableName) || environmentProvider.get('ENV');

  let resources = null;

  // 1: load URL/resource links from a parallel painless config environment
  if (pkg && pkg[painlessConfigEnvPkgName] && environmentName) {
    let pkgName = pkg[painlessConfigEnvPkgName];
    try {
      if (pkgName.startsWith('./')) {
        pkgName = path.join(typescriptConfig.appDirectory, pkgName);
      }
      if (!pkgName.endsWith('.js')) {
        pkgName = path.join(pkgName, 'index.js');
      }
      pkgName = importPathSchemeChangeIfWindows(pkgName);
      const imported = await import(pkgName);
      const inc = imported.default || imported;
      resources = await inc(environmentName, resourcesEnvironmentName);
      // debugStartup(`resources and URL links loaded from ${pkgName}/${environmentName},${resourcesEnvironmentName}`);
    } catch (painlessConfigError) {
      debugStartup(
        `failed attempt to load URLs from ${pkgName}/${environmentName},${resourcesEnvironmentName}`
      );
      console.warn(painlessConfigError);
    }
  }
  if (!resources) {
    // 2: load URL/resource links data from a local JSON file
    try {
      const filename = path.join(typescriptConfig.appDirectory, 'data', 'resources.json');
      const str = await fs.promises.readFile(filename, 'utf8');
      resources = JSON.parse(str);
      debugStartup(`resources and URL links loaded from file ${filename}`);
    } catch (notFound) {
      console.warn(notFound);
    }
  }
  return resources || {};
}
