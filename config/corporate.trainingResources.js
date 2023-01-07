//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

const fs = require('fs');
const path = require('path');

const debug = require('debug')('startup');

const pkg = require('../package.json');

const painlessConfigEnvPkgName = 'painlessConfigEnvironments';
const resourcesEnvironmentName = 'urls';
const painlessConfigEnvironmentVariableName = 'CONFIGURATION_ENVIRONMENT';

const typescriptConfig = require('./typescript');

module.exports = function (graphApi) {
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
      resources = require(pkgName)(environmentName, resourcesEnvironmentName);
      // debug(`resources and URL links loaded from ${pkgName}/${environmentName},${resourcesEnvironmentName}`);
    } catch (painlessConfigError) {
      debug(`failed attempt to load URLs from ${pkgName}/${environmentName},${resourcesEnvironmentName}`);
      console.warn(painlessConfigError);
    }
  }
  if (!resources) {
    // 2: load URL/resource links data from a local JSON file
    try {
      const filename = path.join(typescriptConfig.appDirectory, 'data', 'resources.json');
      const str = fs.readFileSync(filename, 'utf8');
      resources = JSON.parse(str);
      debug(`resources and URL links loaded from file ${filename}`);
    } catch (notFound) {
      console.warn(notFound);
    }
  }
  if (!resources) {
    resources = {};
  }
  return resources;
};
