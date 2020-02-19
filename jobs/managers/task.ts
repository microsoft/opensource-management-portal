//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

/*eslint no-console: ["error", { allow: ["warn", "dir", "log"] }] */

'use strict';

// A simple job to cache the last-known manager e-mail address for linked users
// in Redis, using this app's abstracted APIs to be slightly more generic.

import throat = require('throat');

import { createAndInitializeLinkProviderInstance } from '../../lib/linkProviders';
import { IProviders } from '../../transitional';
import { ILinkProvider } from '../../lib/linkProviders/postgres/postgresLinkProvider';
import { ICorporateLink } from '../../business/corporateLink';
import { Operations, ICachedEmployeeInformation, RedisPrefixManagerInfoCache } from '../../business/operations';

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
    refresh(config, app).then(done => {
      console.log('done');
      process.exit(0);
    }).catch(error => {
      if (insights) {
        insights.trackException({ exception: error, properties: { name: 'JobRefreshManagersFailure' } });
      }
      throw error;
    });
  });
};

async function refresh(config, app) : Promise<void> {
  const providers = app.settings.providers as IProviders;
  const graphProvider = providers.graphProvider;
  const redisHelper = providers.redis;
  const linkProvider = await createAndInitializeLinkProviderInstance(providers, config);

  console.log('reading all links to gather manager info ahead of any terminations');
  const allLinks = await getAllLinks(linkProvider);
  console.log(`READ: ${allLinks.length} links`);
  insights.trackEvent({ name: 'JobRefreshManagersReadLinks', properties: { links: allLinks.length } });

  let errors = 0;
  let notFoundErrors = 0;
  let errorList = [];

  let managerUpdates = 0;
  let managerSets = 0;
  let managerMetadataUpdates = 0;

  const userDetailsThroatCount = 5;
  const secondsDelayAfterError = 1;
  const secondsDelayAfterSuccess = 0.15;

  const managerInfoCachePeriodMinutes = 60 * 24 * 7; // 2 weeks

  await Promise.all(allLinks.map(throat<void, (link: ICorporateLink) => Promise<void>>(async link => {
    const employeeDirectoryId = link.corporateId;

    try {
      const info = await getUserAndManager(graphProvider, employeeDirectoryId);

      if (!info || !info.manager) {
        console.log(`No manager info is set for ${employeeDirectoryId} - ${info.displayName} ${info.userPrincipalName}`);
        return; // no sleep
      }
      if (!info.manager.mail) {
        console.log('No manager mail address');
        throw new Error('No manager mail address in graph');
      }

      const reducedWithManagerInfo: ICachedEmployeeInformation = {
        id: info.id,
        displayName: info.displayName,
        userPrincipalName: info.userPrincipalName,
        managerId: info.manager.id,
        managerDisplayName: info.manager.displayName,
        managerMail: info.manager.mail,
      };

      const key = `${RedisPrefixManagerInfoCache}${employeeDirectoryId}`;
      const currentManagerIfAny = await redisHelper.getObjectCompressedAsync(key) as any;

      if (!currentManagerIfAny) {
        await redisHelper.setObjectCompressedWithExpireAsync(key, reducedWithManagerInfo, managerInfoCachePeriodMinutes);
        ++managerSets;
        console.log(`Manager for ${reducedWithManagerInfo.displayName} set to ${reducedWithManagerInfo.managerDisplayName}`);
      } else {
        let updateEntry = false;
        if (currentManagerIfAny.managerId !== reducedWithManagerInfo.managerId) {
          updateEntry = true;
          ++managerUpdates;
          console.log(`Manager for ${reducedWithManagerInfo.displayName} updated to ${reducedWithManagerInfo.managerDisplayName}`);
        } else if (currentManagerIfAny.id !== reducedWithManagerInfo.id ||
          currentManagerIfAny.displayName !== reducedWithManagerInfo.displayName ||
          currentManagerIfAny.userPrincipalName !== reducedWithManagerInfo.userPrincipalName ||
          currentManagerIfAny.managerDisplayName !== reducedWithManagerInfo.managerDisplayName ||
          currentManagerIfAny.managerMail !== reducedWithManagerInfo.managerMail) {
            updateEntry = true;
            ++managerMetadataUpdates;
            console.log(`Metadata for ${reducedWithManagerInfo.displayName} updated`);
        }
        if (updateEntry) {
          await redisHelper.setObjectCompressedWithExpireAsync(key, reducedWithManagerInfo, managerInfoCachePeriodMinutes);
        }
      }
    } catch (retrievalError) {
      if (retrievalError && retrievalError.status && retrievalError.status === 404) {
        ++notFoundErrors;
        insights.trackEvent({ name: 'JobRefreshManagersNotFound', properties: { error: retrievalError.message } });
      } else {
        console.dir(retrievalError);
        ++errors;
        insights.trackEvent({ name: 'JobRefreshManagersError', properties: { error: retrievalError.message } });
      }
      await sleepPromise(secondsDelayAfterError * 1000);
      return;
    }

    await sleepPromise(secondsDelayAfterSuccess * 1000);

  }, userDetailsThroatCount)));

  console.log('All done with', errors, 'errors. Not found errors:', notFoundErrors);
  console.dir(errorList);
  console.log();

  console.log(`Manager updates: ${managerUpdates}`);
  console.log(`Manager sets:    ${managerSets}`);
  console.log(`Other updates:   ${managerMetadataUpdates}`);
  console.log();
  insights.trackEvent({ name: 'JobRefreshManagersSuccess', properties: { managerUpdates, managerSets, managerMetadataUpdates, errors } });
}

async function getUserAndManager(graphProvider, employeeDirectoryId: string): Promise<any> {
  return new Promise<any>((resolve, reject) => {
    graphProvider.getUserAndManagerById(employeeDirectoryId, (err, info) => {
      if (err) {
        return reject(err);
      }
      return resolve(info);
    });
  });
}

async function getAllLinks(linkProvider: ILinkProvider) : Promise<ICorporateLink[]> {
  return new Promise<ICorporateLink[]>((resolve, reject) => {
    linkProvider.getAll((error, links: ICorporateLink[]) => {
      if (error) {
        return reject(error);
      }
      return resolve(links);
    });
  });
}

function sleepPromise(ms: number): Promise<void> {
  return new Promise<void>(resolve => {
    setTimeout(resolve, ms);
  });
}
