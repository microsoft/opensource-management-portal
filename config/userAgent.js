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

function set(config) {
  config.userAgent = 'env://REPOS_USER_AGENT';
}

set.evaluate = (config) => {
  if (!config.userAgent) {
    config.userAgent = `${pkg.name}/${pkg.version}`;
  }
};

export default set;
