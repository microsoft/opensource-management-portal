//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

// Config hack to be able to understand whether the runtime environment
// is hosted within a 'dist' folder or not.

import path from 'path';
import { fileURLToPath } from 'url';

const entryPoint = process.argv[1];
const hasDist = entryPoint.includes('/dist/') || entryPoint.includes('\\dist\\');

const filename = fileURLToPath(import.meta.url);
const dirname = path.dirname(filename);

const aboveConfig = path.join(dirname, '..');

// console.log(`TypeScript entrypoint: ${entryPoint}, app dir: ${aboveConfig}, dist: ${hasDist}`);

export default {
  dist: hasDist,
  appDirectory: aboveConfig,
};
