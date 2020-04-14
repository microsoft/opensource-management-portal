//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

/*eslint no-console: ["error", { allow: ["warn", "dir", "log"] }] */

'use strict';

import throat = require('throat');

import { IProviders } from '../../transitional';
import { sleep } from '../../utils';
import { IGraphProvider } from '../../lib/graphProvider';
import { LocalExtensionKey } from '../../entities/localExtensionKey/localExtensionKey';

let insights;

module.exports = function run(config) {
  const app = require('../../app');
  config.skipModules = new Set([
    'web',
  ]);

  app.initializeApplication(config, null, error => {
    if (error) {
      throw error;
    }
    insights = app.settings.appInsightsClient;
    if (!insights) {
      throw new Error('No app insights client available');
    }
    cleanup(config, app).then(done => {
      console.log('done');
      process.exit(0);
    }).catch(error => {
      if (insights) {
        insights.trackException({ exception: error, properties: { name: 'JobCleanupKeysFailure' } });
      }
      throw error;
    });
  });
};

async function lookupCorporateId(graphProvider: IGraphProvider, knownUsers: Map<string, any>, corporateId: string): Promise<any> {
  let entry = knownUsers.get(corporateId);
  if (entry === false) {
    return false;
  } else if (entry) {
    return true;
  }

  try {
    const userDetails = await graphProvider.getUserByIdAsync(corporateId);
    if (!userDetails || !userDetails.userPrincipalName) {
      knownUsers.set(corporateId, false);
      return false;
    }
    knownUsers.set(corporateId, userDetails);
    return true;
  } catch (otherUserError) {
    console.dir(otherUserError);
    throw otherUserError;
  }
}

async function cleanup(config, app) : Promise<void> {
  const providers = app.settings.providers as IProviders;
  const graphProvider = providers.graphProvider;
  const localExtensionKeyProvider = providers.localExtensionKeyProvider;

  console.log('reading all keys');
  const allKeys = await localExtensionKeyProvider.getAllKeys();
  console.log(`read ${allKeys.length}`);

  insights.trackEvent({ name: 'JobCleanupTokensKeysTokens', properties: { tokens: allKeys.length } });

  let errors = 0;

  let deleted = 0;
  let okUserTokens = 0;

  const parallelUsers = 2;
  const secondsDelayAfterSuccess = 0.25;

  const knownUsers = new Map<string, any>();

  await Promise.all(allKeys.map(throat<void, (token: LocalExtensionKey) => Promise<void>>(async key => {
    const corporateId = key.corporateId;
    const userStatus = await lookupCorporateId(graphProvider, knownUsers, corporateId);
    if (!userStatus) {
      try {
        ++deleted;
        console.log(`${deleted}: Deleting key for ${corporateId} that could not be found`);
        await localExtensionKeyProvider.delete(key);
      } catch (tokenDeleteError) {
        --deleted;
        console.dir(tokenDeleteError);
        ++errors;
        insights.trackException({ exception: tokenDeleteError });
      }
    } else {
      ++okUserTokens;
      console.log(`${okUserTokens}: valid`);
    }

    await sleep(secondsDelayAfterSuccess * 1000);

  }, parallelUsers)));

  console.log(`deleted: ${deleted}`);
  console.log(`okUserTokens: ${okUserTokens}`);
  console.log();

  insights.trackEvent({ name: 'JobCleanupKeysSuccess', properties: {
      deleted,
      okUserTokens,
      errors,
    },
  });
}
