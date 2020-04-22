//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

/*eslint no-console: ["error", { allow: ["warn", "dir", "log"] }] */

//
// Cleanup events by corporate IDs that are older than 14 days to help
// reduce use over time from churn.
//

import _ from 'lodash';
import throat from 'throat';

import App from '../../app';
import appPackage = require('../../package.json');

import { ILinkProvider } from '../../lib/linkProviders';
import { IProviders, ErrorHelper } from '../../transitional';
import { ICorporateLink } from '../../business/corporateLink';
import { Account } from '../../business/account';
import { sleep, asNumber, quitInAMinute } from '../../utils';
import { EventRecord } from '../../entities/events/eventRecord';
import { IGraphEntry, IGraphProvider } from '../../lib/graphProvider';

const concurrency = 5;

export function run(config: any, reclassify: boolean) {
  App.initializeJob(config, null, (error) => {
    if (error) {
      throw error;
    }
    go(App.settings.providers as IProviders).then(done => {
      console.log('done');
      quitInAMinute(true);
    }).catch(error => {
      console.log(error);
      quitInAMinute(false);
    });
  });
};

async function go(providers: IProviders) : Promise<void> {
  const { linkProvider, operations, eventRecordProvider, graphProvider } = providers;
  const corporateIds = new Set(await linkProvider.getAllCorporateIds());
}
