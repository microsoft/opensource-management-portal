//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

// Job: Backfill aliases (3)
// Job: User attributes hygiene - alias backfills (4)

import job from '../job';

import throat from 'throat';
import { shuffle } from 'lodash';

import { sleep } from '../lib/utils';
import { IProviders, IReposJobResult, UnlinkPurpose } from '../interfaces';
import { ErrorHelper } from '../lib/transitional';

job.runBackgroundJob(refresh, {
  insightsPrefix: 'JobRefreshUsernames',
});

async function refresh(providers: IProviders): Promise<IReposJobResult> {
  const { config, operations, insights, linkProvider, graphProvider } = providers;
  if (config?.jobs?.refreshWrites !== true) {
    console.log('job is currently disabled to avoid metadata refresh/rewrites');
    return;
  }

  const backfillAliasesOnly = config.process.get('BACKFILL_ALIASES') === '1';
  const terminateLinksAndMemberships = config.process.get('REFRESH_USERNAMES_TERMINATE_ACCOUNTS') === '1';

  console.log('reading all links');
  let allLinks = shuffle(await linkProvider.getAll());
  console.log(`READ: ${allLinks.length} links`);

  let backfilledCount = 0;
  if (backfillAliasesOnly) {
    console.log(`backfilling aliases only`);
    allLinks = allLinks.filter((link) => !link.corporateAlias);
    console.log(`FILTERED: ${allLinks.length} links needing aliases`);
  }

  insights.trackEvent({
    name: 'JobRefreshUsernamesReadLinks',
    properties: { links: String(allLinks.length) },
  });

  let errors = 0;
  let notFoundErrors = 0;
  const errorList = [];

  let updates = 0;
  let updatedUsernames = 0;
  let updatedAvatars = 0;
  let updatedAadNames = 0;
  let updatedCorporateMails = 0;
  let updatedAadUpns = 0; // should be super rare

  const userDetailsThroatCount = 1;
  const secondsDelayAfterError = 5;
  const secondsDelayAfterSuccess = 0.25;

  const maxAgeSeconds = 24 * 60 * 60; // details can be a day out-of-date

  const throttle = throat(userDetailsThroatCount);
  let i = 0;
  await Promise.all(
    allLinks.map((link) =>
      throttle(async () => {
        ++i;
        if (i % 100 === 0) {
          console.log(`${i}/${allLinks.length}; total updates=${updates}, errors=${errors}`);
        }

        // Refresh GitHub username for the ID
        const id = link.thirdPartyId;
        const account = operations.getAccount(id);
        let changed = false;
        try {
          try {
            const refreshOptions = {
              maxAgeSeconds,
              backgroundRefresh: false,
            };
            const details = await account.getDetails(refreshOptions);

            if (details.login && link.thirdPartyUsername !== details.login) {
              insights.trackEvent({
                name: 'JobRefreshUsernamesUpdateLogin',
                properties: { old: link.thirdPartyUsername, new: details.login },
              });
              link.thirdPartyUsername = details.login;
              changed = true;
              ++updatedUsernames;
            }

            if (details.avatar_url && link.thirdPartyAvatar !== details.avatar_url) {
              link.thirdPartyAvatar = details.avatar_url;
              changed = true;
              ++updatedAvatars;
            }
          } catch (githubError) {
            if (ErrorHelper.IsNotFound(githubError)) {
              console.warn(
                `Deleted GitHub account, id=${id}, username_was=${link.thirdPartyUsername}; https://api.github.com/users/${link.thirdPartyUsername}`
              );
              insights.trackMetric({ name: 'JobRefreshUsernamesMissingGitHubAccounts', value: 1 });
              insights.trackEvent({
                name: 'JobRefreshUsernamesGitHubAccountNotFound',
                properties: { githubid: id, error: githubError.message },
              });
            } else {
              console.dir(githubError);
            }
            throw githubError;
          }

          try {
            const graphInfo = await graphProvider.getUserById(link.corporateId);
            if (graphInfo) {
              if (graphInfo.userPrincipalName && link.corporateUsername !== graphInfo.userPrincipalName) {
                link.corporateUsername = graphInfo.userPrincipalName;
                changed = true;
                ++updatedAadUpns;
              }
              if (graphInfo.displayName && link.corporateDisplayName !== graphInfo.displayName) {
                link.corporateDisplayName = graphInfo.displayName;
                changed = true;
                ++updatedAadNames;
              }
              if (graphInfo.mail && link.corporateMailAddress !== graphInfo.mail) {
                link.corporateMailAddress = graphInfo.mail;
                changed = true;
                ++updatedCorporateMails;
              }
              if (graphInfo.mailNickname && link.corporateAlias !== graphInfo.mailNickname.toLowerCase()) {
                link.corporateAlias = graphInfo.mailNickname.toLowerCase();
                changed = true;
                if (backfillAliasesOnly) {
                  ++backfilledCount;
                }
              } else if (!graphInfo.mailNickname && backfillAliasesOnly) {
                console.warn(`No mailNickname for ${link.corporateId} (${link.corporateUsername})`);
              }
            }
          } catch (graphLookupError) {
            // Ignore graph lookup issues, other jobs handle terminated employees
            if (ErrorHelper.IsNotFound(graphLookupError)) {
              console.warn(`Deleted AAD account, id=${id}, username_was=${link.corporateUsername}`);
              insights.trackMetric({ name: 'JobRefreshUsernamesMissingCorporateAccounts', value: 1 });
              insights.trackEvent({
                name: 'JobRefreshUsernamesCorporateAccountNotFound',
                properties: { githubid: id, error: graphLookupError.message },
              });
            } else {
              console.dir(graphLookupError);
            }
            throw graphLookupError;
          }

          if (changed) {
            await linkProvider.updateLink(link);
            console.log(`${i}/${allLinks.length}: Updates saved for GitHub user ID ${id}`);
            ++updates;
          }
        } catch (getDetailsError) {
          if (ErrorHelper.IsNotFound(getDetailsError)) {
            ++notFoundErrors;
            insights.trackEvent({
              name: 'JobRefreshUsernamesNotFound',
              properties: { githubid: id, aadId: link.corporateId, error: getDetailsError.message },
            });
            if (terminateLinksAndMemberships) {
              try {
                await operations.terminateLinkAndMemberships(id, { purpose: UnlinkPurpose.Deleted });
                insights.trackEvent({
                  name: 'JobRefreshUsernamesUnlinkDelete',
                  properties: { githubid: id, error: getDetailsError.message },
                });
              } catch (unlinkDeletedAccountError) {
                console.dir(unlinkDeletedAccountError);
                insights.trackException({
                  exception: unlinkDeletedAccountError,
                  properties: { githubid: id, event: 'JobRefreshUsernamesDeleteError' },
                });
              }
            }
          } else {
            console.dir(getDetailsError);
            ++errors;
            insights.trackMetric({ name: 'JobRefreshUsernamesErrors', value: 1 });
            insights.trackException({
              exception: getDetailsError,
              properties: { name: 'JobRefreshUsernamesError' },
            });
            errorList.push(getDetailsError);
            await sleep(secondsDelayAfterError * 1000);
          }
          return;
        }

        await sleep(secondsDelayAfterSuccess * 1000);
      })
    )
  );

  if (backfillAliasesOnly) {
    console.log();
    console.log(`Backfilled ${backfilledCount} aliases`);
    console.log();
  }

  console.log('All done with', errors, 'errors. Not found errors:', notFoundErrors);
  console.dir(errorList);
  console.log();

  console.log(`Updates: ${updates}`);
  console.log(`GitHub username changes: ${updatedUsernames}`);
  console.log(`GitHub avatar changes: ${updatedAvatars}`);
  console.log(`Corporate name changes: ${updatedAadNames}`);
  console.log(`Corporate username changes: ${updatedAadUpns}`);
  console.log(`Updated corporate mails: ${updatedCorporateMails}`);

  return {
    successProperties: {
      updates,
      updatedUsernames,
      updatedAvatars,
      updatedAadNames,
      updatedAadUpns,
      updatedCorporateMails,
      errors,
    },
  };
}
