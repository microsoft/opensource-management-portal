//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

// Modify the package.json file to include the configuration used at deployment time.

const fs = require('fs');
const path = require('path');

const environmentPathName = process.env.ENVIRONMENT_PATH_NAME_OVERRIDE || '.ossdev';

const dockerfilePath = path.join(__dirname, '..', '..', 'Dockerfile');
let dockerfile = fs.readFileSync(dockerfilePath, 'utf8');
console.log(`Adding a copy step to the Dockerfile for our ${environmentPathName} folder.`);

const moniker = '# COPY --from=build /build/.environment ./.environment';
const outcomeMoniker = `COPY --from=build /build/${environmentPathName} ./${environmentPathName}`;

if (!dockerfile.includes(moniker)) {
  throw new Error(`Dockerfile does not contain the expected moniker: ${moniker}`);
}

dockerfile = dockerfile.replace(moniker, outcomeMoniker);
fs.writeFileSync(dockerfilePath, dockerfile, 'utf8');

console.log('Done.');
