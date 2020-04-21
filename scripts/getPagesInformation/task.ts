//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

/*eslint no-console: ["error", { allow: ["warn", "dir", "log"] }] */

import _ from 'lodash';

import app from '../../app';
import { IProviders, ErrorHelper } from '../../transitional';

export function run(config) {
  app.initializeJob(config, null, (error) => {
    if (error) {
      throw error;
    }
    learn(config, app).then(done => {
      console.log('done');
      process.exit(0);
    }).catch(error => {
      throw error;
    });
  });
};

async function learn(config, app) : Promise<void> {
  const { operations } = app.settings.providers as IProviders;
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
