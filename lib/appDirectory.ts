//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

// This is able to understand whether the runtime environment
// is hosted within a 'dist' folder or not, nearly identical
// to the ./config/typescript.ts file in the repo.

import path from 'path';
import { fileURLToPath } from 'url';

export function getTypeScriptAppDirectory() {
  const entryPoint = process.argv[1];
  const hasDist = entryPoint.includes('/dist/') || entryPoint.includes('\\dist\\');

  const filename = fileURLToPath(import.meta.url);
  const dirname = path.dirname(filename);

  const aboveConfig = path.join(dirname, '..');

  return {
    dist: hasDist,
    appDirectory: aboveConfig,
  };
}
