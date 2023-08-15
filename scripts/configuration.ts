//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import job from '../job';

job.run(
  async (providers) => {
    const { config } = providers;
    for (const key of Object.getOwnPropertyNames(config)) {
      console.log(`${key}\n`);
      console.dir(config[key]);
      console.log();
    }
  },
  { name: 'Script: View configuration' }
);
