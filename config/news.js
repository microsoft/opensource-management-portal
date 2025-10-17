//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import path from 'path';
import fs from 'fs';
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
const resourcesEnvironmentName = 'news';
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
    environmentProvider.get(painlessConfigEnvironmentVariableName) || environmentProvider.get('NODE_ENV');
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
      if (!pkgName.endsWith('.js')) {
        pkgName = path.join(pkgName, 'index.js');
      }
      const options = { throwOnError: false };
      pkgName = importPathSchemeChangeIfWindows(pkgName);
      const imported = await import(pkgName);
      const inc = imported.default || imported;
      resources = await inc(environmentName, resourcesEnvironmentName, options);
      // debugStartup(`news loaded from ${pkgName}/${environmentName},${resourcesEnvironmentName}`);
    } catch (painlessConfigError) {
      debugStartup(
        `failed attempt to load news from ${pkgName}/${environmentName},${resourcesEnvironmentName}`
      );
      console.warn(painlessConfigError);
      throw painlessConfigError;
    }
  } else {
    // 2: try to load URL/resource links data from a local JSON file
    try {
      const filename = path.join(typescriptConfig.appDirectory, 'data', 'news.json');
      const str = fs.readFileSync(filename, 'utf8');
      resources = JSON.parse(str);
      debugStartup(`news loaded from file ${filename}`);
    } catch (notFound) {
      if (notFound.code !== 'ENOENT') {
        console.warn(notFound);
        throw notFound;
      }
    }
  }

  articles = Array.isArray(resources) ? resources : [];

  return {
    all: articles,
    homepage: articles.slice(0, homepageCount),
  };
}
