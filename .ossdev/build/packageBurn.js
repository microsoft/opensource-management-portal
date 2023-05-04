//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

// Modify the package.json file to include the configuration used at deployment time.

const fs = require('fs');
const path = require('path');

const environmentRelativePath = './.ossdev/environment';

const packageJsonPath = path.join(__dirname, '..', '..', 'package.json');
const packageJson = require(packageJsonPath);
console.log(
  `Setting packageJson.painlessConfigEnvironments to ${environmentRelativePath} in ${packageJsonPath}`
);
packageJson.painlessConfigEnvironments = environmentRelativePath;

fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));

console.log('Done.');
