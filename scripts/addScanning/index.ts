//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import throat from 'throat';
import _ from 'lodash';

async function go(providers: IProviders): Promise<void> {
  // ---------------------------------------------------------------------------

  const { operations, linkProvider, graphProvider } = providers;

  const org = operations.getOrganization('azure');
  let repos = await org.getRepositories();
  repos = _.shuffle(repos);
  let xi = 0;
  for (const repo of repos) {
    if (xi > 25) {
      console.log('we enabled on 25');
      return;
    }
    if (!repo.private) continue;
    try {
       await repo.getDetails();
       const val = await repo.checkSecretScanning();
       if (!val) {
         await repo.enableSecretScanning();
         console.log(`ENABLED for repo: ${repo.full_name}`);
         ++xi;
        }
//       console.log(`repo: ${repo.full_name}, status of scanning: ${val ? 'ON' : 'OFF'}`);
       console.log();
    } catch (error) {
      console.log();
      console.log(`${repo.full_name}: ${error}`);
    }
    console.log();
  }



  // ---------------------------------------------------------------------------
}




















// -----------------------------------------------------------------------------
// Local script initialization
// -----------------------------------------------------------------------------
import app, { IReposJob } from '../../app';
import { IProviders, ErrorHelper } from '../../transitional';
console.log('Initializing the script run...');

app.runJob(async function ({ providers }: IReposJob) {
  await go(providers);
  return {};
}, {
  treatGitHubAppAsBackground: false,
});
