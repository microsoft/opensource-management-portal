//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import appRoot from 'app-root-path';
import deepmerge from 'deepmerge';
import fs from 'fs';
import path from 'path';
import { ILibraryOptions, InnerError, IProviderOptions } from '.';

import graphBuilder from './graphBuilder';

async function composeGraphs(api: ILibraryOptions) {
  api = api || {};
  const options = api.options || {};
  const applicationRoot = (options.applicationRoot || appRoot).toString();

  const paths: string[] = [];

  // Configuration directory presence in the app
  // -------------------------------------------
  addAppConfigDirectory(paths, api, options, applicationRoot);

  // Configuration packages defined explicitly in app's package.json
  // ---------------------------------------------------------------
  const pkg = getPackage(applicationRoot);
  if (pkg && pkg.painlessConfigObjectPackages) {
    const pco = Array.isArray(pkg.painlessConfigObjectPackages)
      ? pkg.painlessConfigObjectPackages
      : pkg.painlessConfigObjectPackages.split(',');
    addConfigPackages(paths, applicationRoot, pco);
  }

  // Environment-based configuration packages
  // ----------------------------------------
  const environment = api.environment;
  if (!environment) {
    console.warn(
      `libraryOptions has no environment property, environment-based configuration packages not available`
    );
  }
  const additionalPackagesKey = environment?.get('CONFIGURATION_PACKAGES_KEY') || 'CONFIGURATION_PACKAGES';
  const configurationPackages = environment?.get(additionalPackagesKey) as string;
  if (configurationPackages) {
    const packages = configurationPackages.split(',');
    addConfigPackages(paths, applicationRoot, packages);
  }

  if (paths.length === 0) {
    throw new Error(
      'No configuration packages or directories were found to process. Consider using "options.graph" as an option to the configuration resolver if you do not need to use configuration directories. Otherwise, check that you have configured your package.json or other environment values as needed.'
    );
  }

  // Build the graph
  // ---------------
  let graph = {};
  for (const p of paths.reverse()) {
    const result = await graphBuilder(api, p);
    const overwriteMerge = (destinationArray: any, sourceArray: any /* , options*/) => sourceArray;
    graph = deepmerge(graph, result, { arrayMerge: overwriteMerge });
  }
  if (!graph || Object.getOwnPropertyNames(graph).length === 0) {
    throw new Error(
      `Successfully processed ${paths.length} configuration graph packages or directories, yet the resulting graph object did not have properties. This is likely an error or issue that should be corrected. Or, alternatively, use options.graph as an input to the resolver.`
    );
  }
  return graph;
}

function addConfigPackages(paths: string[], applicationRoot: string, painlessConfigObjects: string[]) {
  for (let i = 0; i < painlessConfigObjects.length; i++) {
    addConfigPackage(paths, applicationRoot, painlessConfigObjects[i]);
  }
}

function getPackage(applicationRoot: string) {
  try {
    const pkgPath = path.join(applicationRoot, 'package.json');
    return require(pkgPath);
  } catch (noPackageJson) {
    // It's OK if the app doesn't have a package.json
  }
}

function addConfigPackage(paths: string[], applicationRoot: string, npmName: string) {
  let root = null;
  let packageInstance = null;
  npmName = npmName.trim();
  if (!npmName.startsWith('.')) {
    try {
      packageInstance = require(npmName);
    } catch (cannotRequire) {
      throw new Error(`While trying to identify configuration graphs, ${npmName} could not be required`, {
        cause: cannotRequire,
      });
    }
    if (typeof packageInstance === 'string') {
      root = packageInstance;
    } else {
      throw new Error(
        `The package ${npmName} instance is not of type string. For the configuration graph system it should be a string (a path).`
      );
    }
  } else {
    root = path.resolve(path.join(applicationRoot, npmName));
  }
  try {
    fs.statSync(root);
    paths.push(root);
  } catch (notFound) {
    if (packageInstance) {
      throw new Error(
        `While instantiating "${npmName}, the returned string value was not a valid path: ${root}`
      );
    } else {
      throw new Error(`Could not locate the local configuration directory for package "${npmName}": ${root}`);
    }
  }
}

function addAppConfigDirectory(
  paths: string[],
  api: ILibraryOptions,
  options: IProviderOptions,
  applicationRoot: string
) {
  let directoryName = options.directoryName;
  let key = null;
  if (!directoryName && api.environment) {
    key = api.environment.get('CONFIGURATION_GRAPH_DIRECTORY_KEY') || 'CONFIGURATION_GRAPH_DIRECTORY';
    directoryName = api.environment.get(key);
  }
  if (!directoryName) {
    return;
  }
  const dirPath = path.join(applicationRoot, directoryName);
  try {
    fs.statSync(dirPath);
    paths.push(dirPath);
  } catch (notFound) {
    throw new Error(`The configuration graph directory ${dirPath} was not found. ${key}`, {
      cause: notFound,
    });
  }
}

export default composeGraphs;
