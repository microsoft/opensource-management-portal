//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import fs from 'fs';
import path from 'path';

import { pathToFileURL } from 'url';

import typescriptConfig from './typescript.js';
import arrayFromString from './utils/arrayFromString.js';

// GITHUB_ORGANIZATIONS_TEMPLATES_TYPE: 'npm' or 'fs', 'fs' default
// GITHUB_ORGANIZATIONS_TEMPLATES_RELATIVE_DIRECTORY: relative to app dir, defaults to 'data/templates'
// GITHUB_ORGANIZATIONS_TEMPLATES_PACKAGE_NAME: npm package name if type mode is 'npm', no default

// GITHUB_ORGANIZATIONS_DEFAULT_TEMPLATES

const isWindows = process.platform === 'win32';

function importPathSchemeChangeIfWindows(npmName) {
  if (isWindows && path.isAbsolute(npmName)) {
    const normalized = path.normalize(npmName);
    const fileUrl = pathToFileURL(normalized);
    return fileUrl.href;
  }
  return npmName;
}

export default async (graphApi) => {
  const environmentProvider = graphApi.environment;
  const configurationEnvironmentName = environmentProvider.get('CONFIGURATION_ENVIRONMENT');
  const defaultDirectory = path.join('data', 'templates');

  // 'npm' or 'fs'
  let templateSourceType = environmentProvider.get('GITHUB_ORGANIZATIONS_TEMPLATES_TYPE') || 'fs';
  if (templateSourceType !== 'npm' && templateSourceType !== 'fs') {
    console.warn(
      `GITHUB_ORGANIZATIONS_TEMPLATES_TYPE must be either 'fs' or 'npm', defaulting to 'fs' as '${templateSourceType} is unrecognized`
    );
    templateSourceType = 'fs';
  }

  let templates = {
    directory:
      templateSourceType === 'fs'
        ? environmentProvider.get('GITHUB_ORGANIZATIONS_TEMPLATES_RELATIVE_DIRECTORY') || defaultDirectory
        : null,
    definitions: null,
    defaultTemplates: arrayFromString(
      environmentProvider.get('GITHUB_ORGANIZATIONS_DEFAULT_TEMPLATES') || ''
    ),
  };

  if (templateSourceType === 'fs') {
    templates.directory = path.join(typescriptConfig.appDirectory, templates.directory);
    const filename = path.join(templates.directory, 'definitions.json');
    try {
      const str = fs.readFileSync(filename, 'utf8');
      templates.definitions = JSON.parse(str);
    } catch (notFound) {
      console.warn(`Template definitions could not be loaded from ${filename}: ${notFound.toString()}`);
      throw notFound;
    }
  } else if (templateSourceType === 'npm') {
    let npmName = environmentProvider.get('GITHUB_ORGANIZATIONS_TEMPLATES_PACKAGE_NAME');
    if (!npmName) {
      throw new Error(
        "When GITHUB_ORGANIZATIONS_TEMPLATES_TYPE is set to 'npm', GITHUB_ORGANIZATIONS_TEMPLATES_PACKAGE_NAME must be set"
      );
    }
    try {
      npmName = importPathSchemeChangeIfWindows(npmName);
      const imported = await import(npmName);
      const inc = imported.default || imported;
      const templatePackageData = inc;
      if (!templatePackageData || typeof templatePackageData !== 'object') {
        throw new Error(`${npmName} did not return data or an object`);
      }
      if (!templatePackageData.directory) {
        throw new Error(`${npmName} did not return an object with a 'directory' property`);
      }
      if (!templatePackageData.definitions) {
        throw new Error(`${npmName} did not return an object with a 'definitions' property`);
      }
      templates = templatePackageData;
    } catch (templatesNpmLoadError) {
      throw new Error(
        `Trouble loading npm package ${npmName} as configured in GITHUB_ORGANIZATIONS_TEMPLATES_PACKAGE_NAME: ${templatesNpmLoadError.toString()}`,
        { cause: templatesNpmLoadError }
      );
    }
  }

  if (templates.definitions) {
    const clonedDefinitions = Object.assign({}, templates.definitions);
    const names = Object.getOwnPropertyNames(clonedDefinitions);
    for (let i = 0; i < names.length; i++) {
      const definition = clonedDefinitions[names[i]];
      if (!definition.environments || definition.environments.includes(configurationEnvironmentName)) {
        // keep this template around
      } else {
        delete clonedDefinitions[names[i]];
      }
    }
    templates.definitions = clonedDefinitions;
  }

  return templates;
};
