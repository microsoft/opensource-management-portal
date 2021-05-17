//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { promises as fs } from 'fs';
import objectPath from 'object-path';
import path from 'path';
import stripJsonComments from 'strip-json-comments';
import { ILibraryOptions } from '.';

const supportedExtensions = new Map([
  ['.js', scriptProcessor],
  ['.json', jsonProcessor],
  ['.jsonc', jsoncProcessor],
]);

async function scriptProcessor(api: ILibraryOptions, config: any, p: string) {
  const script = require(p);
  return typeof(script) === 'function' ? script(api, config) : script;
}

async function jsonProcessor(api: ILibraryOptions, config: any, p: string) {
  return require(p);
}

async function jsoncProcessor(api: ILibraryOptions, config: any, p: string) {
  const contents = await fs.readFile(p, 'utf8');
  const stripped = stripJsonComments(contents);
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
    const processor = supportedExtensions.get(ext);
    if (!processor) {
      continue;
    }
    try {
      const value = await processor(api, config, file);
      if (value && typeof(value) === 'string' && value === dirPath) {
        // Skip the index.js for local hybrid package scenarios
      } else if (value !== undefined) {
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
