//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

/*eslint no-console: ["error", { allow: ["warn", "dir", "log"] }] */

import _ from 'lodash';

import { IProviders, ErrorHelper } from '../../transitional';
import { IReposJob } from '../../app';

export default async function learn({ providers }: IReposJob) : Promise<void> {
  const { operations } = providers;
  const allRepos = await operations.getRepos();
  console.log('org,repo,pages,cname');
  for (let i = 0; i < allRepos.length; i++) {
    const repo = allRepos[i];
    try {
      const pageInformation = await repo.getPages();
      console.log(`${repo.organization.name},${repo.name},${pageInformation.html_url},${pageInformation.cname ? pageInformation.cname : ''}`);
    } catch (error) {
      if (ErrorHelper.IsNotFound(error)) {
        // no pages
      } else {
        console.dir(error);
      }
    }
  }
}
