//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

/*eslint no-console: ["error", { allow: ["warn", "dir", "log"] }] */

// A simple job to cache the last-known manager e-mail address for linked users
// in Redis, using this app's abstracted APIs to be slightly more generic.

import throat from 'throat';

import App from '../../app';
import { createAndInitializeLinkProviderInstance, ILinkProvider } from '../../lib/linkProviders';
import { IProviders } from '../../transitional';
import { ICorporateLink } from '../../business/corporateLink';
import { ICachedEmployeeInformation, RedisPrefixManagerInfoCache } from '../../business/operations';
import { sleep, quitInAMinute } from '../../utils';
import { IMicrosoftIdentityServiceBasics } from '../../lib/corporateContactProvider';

let insights;

export default function Task(config) {
  App.initializeJob(config, null, error => {
    if (error) {
      throw error;
    }
    insights = App.settings.appInsightsClient;
    if (!insights) {
      throw new Error('No app insights client available');
    }
    refresh(config, App).then(done => {
      console.log('done');
      return quitInAMinute(true);
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
  const cacheHelper = providers.cacheProvider;
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
  const secondsDelayAfterSuccess = 0.1;

  const managerInfoCachePeriodMinutes = 60 * 24 * 7; // 2 weeks

  let processed = 0;

  const bulkContacts = new Map<string, IMicrosoftIdentityServiceBasics>();

  const throttle = throat(userDetailsThroatCount);
  await Promise.all(allLinks.map((link: ICorporateLink) => throttle(async () => {
    const employeeDirectoryId = link.corporateId;
    console.log(`${++processed}.`);
    let info =  null, infoError = null;
    try {
      info = await getUserAndManager(graphProvider, employeeDirectoryId);
    } catch (retrievalError) {
      infoError = retrievalError;
    }
    if (providers.corporateContactProvider && (info && info.userPrincipalName || link.corporateUsername)) {
      try {
        const userPrincipalName = info && info.userPrincipalName ? info.userPrincipalName : link.corporateUsername;
        const contactsCache = await providers.corporateContactProvider.lookupContacts(userPrincipalName);
        if (contactsCache || (!contactsCache && link.isServiceAccount)) {
          bulkContacts.set(userPrincipalName, contactsCache);
        }
      } catch (identityServiceError) {
        // Bulk cache is a secondary function of this job
        console.warn(identityServiceError);
      }
    }
    if (link.isServiceAccount) {
      console.log(`skipping service account link ${link.corporateUsername}`);
      return;
    }
    try {
      if (infoError) {
        throw infoError;
      }
      if (!info || !info.manager) {
        console.log(`No manager info is set for ${employeeDirectoryId} - ${info.displayName} ${info.userPrincipalName}`);
        return; // no sleep
      }
      // Has the user's corporate display information changed?
      let linkChanges = false;
      if (info.displayName !== link.corporateDisplayName) {
        linkChanges = true;
        console.log(`Update to corporate link: display name changed from ${link.corporateDisplayName} to ${info.displayName}`);
        link.corporateDisplayName = info.displayName;
      }
      if (info.userPrincipalName !== link.corporateUsername) {
        linkChanges = true;
        console.log(`Update to corporate link: username changed from ${link.corporateUsername} to ${info.userPrincipalName}`);
        link.corporateUsername = info.disuserPrincipalNameplayName;
      }
      if (linkChanges) {
        await linkProvider.updateLink(link);
        console.log(`Updated link for ${link.corporateId}`);
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
      const currentManagerIfAny = await cacheHelper.getObjectCompressed(key) as any;
      if (!currentManagerIfAny) {
        await cacheHelper.setObjectCompressedWithExpire(key, reducedWithManagerInfo, managerInfoCachePeriodMinutes);
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
          await cacheHelper.setObjectCompressedWithExpire(key, reducedWithManagerInfo, managerInfoCachePeriodMinutes);
        }
      }
    } catch (retrievalError) {
      if (retrievalError && retrievalError.status && retrievalError.status === 404) {
        ++notFoundErrors;
        console.log(`deleting: ${link.corporateUsername}`);
        // Not deleting links so proactively: await linkProvider.deleteLink(link);
        insights.trackEvent({ name: 'JobRefreshManagersNotFound', properties: { error: retrievalError.message } });
      } else {
        console.dir(retrievalError);
        ++errors;
        insights.trackEvent({ name: 'JobRefreshManagersError', properties: { error: retrievalError.message } });
      }
      await sleep(secondsDelayAfterError * 1000);
      return;
    }
    await sleep(secondsDelayAfterSuccess * 1000);
  })));

  console.log('All done with', errors, 'errors. Not found errors:', notFoundErrors);
  console.dir(errorList);
  console.log();

  if (bulkContacts.size) {
    console.log(`Writing ${bulkContacts.size} contacts to bulk cache...`);
    try {
      await providers.corporateContactProvider.setBulkCachedContacts(bulkContacts);
      console.log('Cached.');
    } catch (cacheError) {
      console.log('Cache problem:');
      console.warn(cacheError);
    }
  }

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
  return linkProvider.getAll();
}
