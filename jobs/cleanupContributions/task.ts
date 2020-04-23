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

import { IReposJob } from '../../app';
import appPackage = require('../../package.json');

import { ILinkProvider } from '../../lib/linkProviders';
import { IProviders, ErrorHelper } from '../../transitional';
import { ICorporateLink } from '../../business/corporateLink';
import { Account } from '../../business/account';
import { sleep, asNumber, quitInTenSeconds } from '../../utils';
import { EventRecord } from '../../entities/events/eventRecord';
import { IGraphEntry, IGraphProvider } from '../../lib/graphProvider';

const concurrency = 5;

export default async function job({ providers }: IReposJob) : Promise<void> {
  const { linkProvider, operations, eventRecordProvider, graphProvider } = providers;
  const corporateIds = new Set(await linkProvider.getAllCorporateIds());
}
