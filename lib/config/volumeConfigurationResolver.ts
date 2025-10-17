//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import objectPath from 'object-path';
import os from 'os';
import { promises as fs } from 'fs';
import path from 'path';

import type { IPainlessConfigGet, IProviderOptions } from './index.js';

// Volume Assumptions:
// For now, the simple model, the volume is defined in PCR_VOLUME_MOUNT.
// The file is the value after volumefile:.

const pcrVolumeMountVariable = 'PCR_VOLUME_MOUNT';
const volumeFilePrefix = 'volumefile:';

let pcrVolumeResolved: string = null;

function getAsVolumeFile(value: string) {
  if (value?.startsWith && value.startsWith(volumeFilePrefix)) {
    const i = value.indexOf(volumeFilePrefix);
    const v = value.substr(i + volumeFilePrefix.length);
    return path.basename(v);
  }
  return undefined;
}

function getPcrVolume(provider: IPainlessConfigGet) {
  if (pcrVolumeResolved) {
    return pcrVolumeResolved;
  }
  let volumePath = provider.get(pcrVolumeMountVariable);
  if (!volumePath) {
    throw new Error(`Unable to resolve volume path ${volumePath}, no defined ${pcrVolumeMountVariable}`);
  }
  if (volumePath.startsWith('~/')) {
    volumePath = path.join(os.homedir(), volumePath.slice(2));
  }
  pcrVolumeResolved = volumePath;
  return volumePath;
}

async function resolveVolumeFile(provider: IPainlessConfigGet, volumeFile: string) {
  const volumePath = getPcrVolume(provider);
  const combined = path.resolve(volumePath, volumeFile);
  try {
    const contents = await fs.readFile(combined, 'utf8');
    return contents.trim();
  } catch (error) {
    throw new Error(`Unable to resolve volume file ${volumeFile} from ${pcrVolumeMountVariable}: ${error}`);
  }
}

async function identifyPaths(provider: IPainlessConfigGet, node: any, prefix?: string) {
  prefix = prefix !== undefined ? prefix + '.' : '';
  const paths: any = {};
  for (const property in node) {
    const value = node[property];
    if (typeof value === 'object') {
      const recursion = await identifyPaths(provider, value, prefix + property);
      Object.assign(paths, recursion);
      continue;
    }
    if (typeof value !== 'string') {
      continue;
    }
    const asVolumeFile = getAsVolumeFile(value);
    if (!asVolumeFile) {
      continue;
    }
    paths[prefix + property] = await resolveVolumeFile(provider, asVolumeFile);
  }
  return paths;
}

function defaultProvider() {
  return {
    providerName: 'default process.env',
    get: (key: string) => {
      return process.env[key];
    },
  };
}

function createClient(options?: IProviderOptions) {
  options = options || {};
  const provider = options.provider || defaultProvider();
  return {
    providerName: 'volume configuration resolver',
    resolveVolumeFile,
    isVolumeFile: getAsVolumeFile,
    resolveVolumeFiles: async (object: any) => {
      let paths = null;
      try {
        paths = await identifyPaths(provider, object);
      } catch (parseError) {
        throw parseError;
      }
      const names = Object.getOwnPropertyNames(paths);
      for (let i = 0; i < names.length; i++) {
        const p = names[i];
        const volumeValue = paths[p];
        objectPath.set(object, p, volumeValue);
      }
    },
  };
}

export default createClient;
