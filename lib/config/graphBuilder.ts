//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { promises as fs } from 'fs';
import objectPath from 'object-path';
import path from 'path';
import { jsonc } from 'jsonc';

import { importPathSchemeChangeIfWindows } from '../utils.js';
import type { ILibraryOptions } from './index.js';

const SUPPORTED_EXTENSIONS = new Map([
  ['.js', scriptProcessor],
  ['.json', jsonProcessor],
  ['.jsonc', jsoncProcessor],
]);

const EXCLUDED_CONFIG_FILE_PREFIXES = ['environmentFileReader', 'utils'];

async function scriptProcessor(api: ILibraryOptions, config: any, p: string) {
  const alteredImport = importPathSchemeChangeIfWindows(p);
  const imported = await import(alteredImport);
  const script = imported.default || imported;
  return typeof script === 'function' ? script(api, config) : script;
}

async function jsonProcessor(api: ILibraryOptions, config: any, p: string) {
  const raw = await fs.readFile(p, 'utf8');
  return JSON.parse(raw);
}

async function jsoncProcessor(api: ILibraryOptions, config: any, p: string) {
  const contents = await fs.readFile(p, 'utf8');
  const stripped = jsonc.parse(contents);
  return JSON.parse(stripped);
}

export default async (api: ILibraryOptions, dirPath: string) => {
  api = api || {};
  const options = api.options || {};

  const treatErrorsAsWarnings = options.treatErrorsAsWarnings || false;
  const requireConfigurationDirectory = options.requireConfigurationDirectory || false;

  const config = {};
  let files: string[] = [];
  try {
    files = await fs.readdir(dirPath);
  } catch (directoryError) {
    // behavior change: version 1.x of this library through whenever this error'd, not just if required
    if (requireConfigurationDirectory) {
      throw directoryError;
    }
  }
  for (let i = 0; i < files.length; i++) {
    const file = path.join(dirPath, files[i]);
    const ext = path.extname(file);
    const nodeName = path.basename(file, ext);
    // Exclude any TypeScript-related typing files (special case)
    if (nodeName.endsWith('.types')) {
      continue;
    }
    if (EXCLUDED_CONFIG_FILE_PREFIXES.includes(nodeName)) {
      continue;
    }
    const processor = SUPPORTED_EXTENSIONS.get(ext);
    if (!processor) {
      console.warn(`Configuration graph: unsupported configuration extension: ${ext} for path: ${file}`);
      continue;
    }
    try {
      let value = await processor(api, config, file);
      if (value && typeof value === 'string' && value === dirPath) {
        // Skip the index.js for local hybrid package scenarios
      } else if (value !== undefined) {
        if (objectPath.has(config, nodeName)) {
          value = { ...objectPath.get(config, nodeName), ...value };
        }
        objectPath.set(config, nodeName, value);
      }
    } catch (ex) {
      ex.path = file;
      if (treatErrorsAsWarnings) {
        objectPath.set(config, nodeName, ex);
      } else {
        throw ex;
      }
    }
  }
  return config;
};
