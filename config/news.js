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
const resourcesEnvironmentName = 'news';
const painlessConfigEnvironmentVariableName = 'CONFIGURATION_ENVIRONMENT';

const typescriptConfig = require('./typescript');

module.exports = function (graphApi) {
  const environmentProvider = graphApi.environment;
  const environmentName =
    environmentProvider.get(painlessConfigEnvironmentVariableName) || environmentProvider.get('ENV');

  const homepageCount = 10;

  let articles = [];
  let resources = null;

  // 1: load news
  let pkgName = null;
  if (pkg && pkg[painlessConfigEnvPkgName] && environmentName) {
    try {
      pkgName = pkg[painlessConfigEnvPkgName];
      if (pkgName.startsWith('./')) {
        pkgName = path.join(typescriptConfig.appDirectory, pkgName);
      }
      const options = { throwOnError: false };
      resources = require(pkgName)(environmentName, resourcesEnvironmentName, options);
      // debug(`news loaded from ${pkgName}/${environmentName},${resourcesEnvironmentName}`);
    } catch (painlessConfigError) {
      debug(`failed attempt to load news from ${pkgName}/${environmentName},${resourcesEnvironmentName}`);
      console.warn(painlessConfigError);
      throw painlessConfigError;
    }
  } else {
    // 2: load URL/resource links data from a local JSON file
    try {
      const filename = path.join(typescriptConfig.appDirectory, 'data', 'news.json');
      const str = fs.readFileSync(filename, 'utf8');
      resources = JSON.parse(str);
      debug(`news loaded from file ${filename}`);
    } catch (notFound) {
      console.warn(notFound);
      throw notFound;
    }
  }

  if (Array.isArray(resources)) {
    articles = resources;
  }

  return {
    all: articles,
    homepage: articles.slice(0, homepageCount),
  };
};
