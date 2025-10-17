//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

// import pkg from '../package.json' with { type: 'json' };
// eslint as of 2024-04-01 does not support the assert syntax yet
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const filename = fileURLToPath(import.meta.url);
const dirname = path.dirname(filename);
const pkg = JSON.parse(fs.readFileSync(path.join(dirname, '../package.json'), 'utf8'));

export default () => {
  // Useful information to help understand which CI/CD pipeline the app came from
  const continuousDeployment = stripPlaceholders(pkg.continuousDeployment);
  continuousDeployment.version = pkg.version;
  continuousDeployment.name = pkg.name;
  return continuousDeployment;
};

function stripPlaceholders(obj) {
  obj = obj || {};
  const keys = Object.getOwnPropertyNames(obj);
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const value = obj[key];
    if (value && typeof value === 'string') {
      if (value.startsWith('__') && value.endsWith('__')) {
        delete obj[key];
      }
    }
  }
  return obj;
}
