//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

async function go(providers: IProviders): Promise<void> {
  const { config } = providers;
  for (const key of Object.getOwnPropertyNames(config)) {
    console.log(`${key}\n`);
    console.dir(config[key]);
    console.log();
  }
}

import app from '../app';
import { IProviders, IReposJob } from '../interfaces';

app.runJob(
  async function ({ providers }: IReposJob) {
    await go(providers);
    return {};
  },
  {
    enableAllGitHubApps: true,
  }
);
