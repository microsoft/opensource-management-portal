//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import throat from 'throat';

async function go(providers: IProviders): Promise<void> {
  // ---------------------------------------------------------------------------

  providers.app.isBackgroundJob = false;

  const { linkProvider, graphProvider } = providers;

  const all = await linkProvider.getAll();

  // concerning links
  let concerns = 0, ok = 0;
  let i = 0;
  const count = all.length;
  const throttle = throat(10);
  await Promise.all(all.map(link => throttle(async () => {
    try {
      if (link.isServiceAccount) {
        // console.log(`${++i}: skipping service account ${link.corporateUsername}`);
        return;
      }
      const user = await graphProvider.getUserByIdAsync(link.corporateId);
      if (user && user.userPrincipalName) {
        ++ok;
        // console.log(`ok=${ok}, concerns=${concerns}, i=${++i} of ${count}`);
      } else {
        console.log(`ok=${ok}, concerns=${++concerns}, i=${++i} of ${count}; [CONCERN] no graph result for name=${link.corporateDisplayName}, upn= ${link.corporateUsername}, login= ${link.thirdPartyUsername}`);
        const halt = false;
      }
    } catch (error) {
      console.log(`ok=${ok}, concerns=${++concerns}, i=${++i} of ${count}`);
      if (ErrorHelper.IsNotFound(error)) {
        console.log(`404: ${error}`);
      } else {
        console.log(error);
      }
    }
  })));

  // concerning unlinked















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
});
