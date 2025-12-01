//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import path from 'path';
import debug from 'debug';

//
// options type:
// type Options = {
//   before?: (graphApi: GraphApi) => Promise<any> | any;
//   after?: (graphApi: GraphApi, data: any) => Promise<any> | any;
// }
//

const debugStartup = debug('startup');
const debugEnvironmentReader = debug('startup:env');

import fs from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
const isWindows = process.platform === 'win32';

const filename = fileURLToPath(import.meta.url);
const dirname = path.dirname(filename);
const pkg = JSON.parse(fs.readFileSync(path.join(dirname, '../package.json'), 'utf8'));

function importPathSchemeChangeIfWindows(npmName) {
  if (isWindows && path.isAbsolute(npmName)) {
    const normalized = path.normalize(npmName);
    const fileUrl = pathToFileURL(normalized);
    return fileUrl.href;
  }
  return npmName;
}

import typescriptConfig from './typescript.js';

const PAINLESS_CONFIG_ENV_PKG_NAME = 'painlessConfigEnvironments';
const PAINLESS_CONFIG_ENV_VAR_NAME = 'CONFIGURATION_ENVIRONMENT';

const createEnvironmentFileResolver = (sourceName, environmentDirectoryName, environmentName, options) => {
  if (!environmentDirectoryName) {
    throw new Error('environmentFileReader: environmentDirectoryName is required from ' + sourceName);
  }
  if (!environmentName) {
    throw new Error('environmentFileReader: environmentName is required from ' + sourceName);
  }
  options = options || {};
  debugEnvironmentReader(
    'Created an instance of environmentFileReader for ' +
      sourceName +
      ' with env dir ' +
      environmentDirectoryName +
      ' and env name ' +
      environmentName
  );
  return async function (graphApi) {
    debugEnvironmentReader('Resolving configuration for ' + sourceName);
    let data = null;
    if (options?.before) {
      debugEnvironmentReader('Invoking before hook for ' + sourceName);
      data = await options.before(graphApi);
      const hasData = !!data;
      debugEnvironmentReader(
        'Completed before hook for ' +
          sourceName +
          ' ' +
          (hasData ? 'using that data' : 'continuing to painless config (no data)')
      );
    }
    if (!data) {
      const environmentProvider = graphApi.environment;
      const targetEnvFileName =
        environmentProvider.get(environmentName) ||
        environmentProvider.get(PAINLESS_CONFIG_ENV_VAR_NAME) ||
        environmentProvider.get('NODE_ENV');
      debugEnvironmentReader(
        `Target environment file name for ${sourceName} is resolved to: ${targetEnvFileName}`
      );
      // 1: load data
      let pkgName = null;
      if (pkg && pkg[PAINLESS_CONFIG_ENV_PKG_NAME] && targetEnvFileName) {
        debugEnvironmentReader(
          `Package with key ${PAINLESS_CONFIG_ENV_PKG_NAME} found, attempting to load painless config for ${sourceName}`
        );
        try {
          pkgName = pkg[PAINLESS_CONFIG_ENV_PKG_NAME];
          if (pkgName.startsWith('./')) {
            pkgName = path.join(typescriptConfig.appDirectory, pkgName);
          }
          if (!pkgName.endsWith('.js')) {
            pkgName = path.join(pkgName, 'index.js');
          }
          pkgName = importPathSchemeChangeIfWindows(pkgName);
          const options = { throwOnError: false };
          const imported = await import(pkgName);
          const inc = imported.default || imported;
          debugEnvironmentReader(
            `Import of painless config environment package ${pkgName} for ${sourceName} succeeded; will load now`
          );
          data = await inc(targetEnvFileName, environmentDirectoryName, options);
          const hasData = !!data;
          debugEnvironmentReader(
            `Painless config load for ${sourceName} with package ${pkgName} ` +
              (hasData ? 'succeeded with data' : 'did not find data')
          );
        } catch (painlessConfigError) {
          debugStartup(
            `failed attempt to load ${environmentDirectoryName} from ${pkgName}/${targetEnvFileName},${environmentDirectoryName} via ${sourceName}`
          );
          console.warn(painlessConfigError);
          throw painlessConfigError;
        }
      }
    }
    const res = data || {};
    if (options?.after) {
      debugEnvironmentReader('Invoking after hook for ' + sourceName);
      const result = await options.after(graphApi, res);
      debugEnvironmentReader('Completed after hook for ' + sourceName);
      return result;
    }
    return res;
  };
};

export default createEnvironmentFileResolver;
