//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

/*eslint no-console: ["error", { allow: ["warn", "dir", "log"] }] */

// Open source contribution calculations
// inspired by Indeed's Starfish project for FOSS Funding (https://github.com/indeedeng/starfish)
//
// This job retrieves and caches public events from GitHub for any linked corporate
// users. Events are other gathered while the users are linked.
//
// Types of contributions include:
// - creating pull requests
// - creating issues
// - commenting on issues
// - performing pull request reviews
//
// Contributions that are _not considered opened source_ today:
// - contributions to corporate GitHub public repos 
// - contributions to forks of corporate repos
// - contributions to your own individual repos
//
// To accomplish this, beyond the configured data, there may also
// need to be a set of "unofficial" corporate orgs, or overrides
// for things clearly open source.
//

import _ = require('lodash');
import throat from 'throat';

import appPackage = require('../../package.json');

import { ILinkProvider } from '../../lib/linkProviders';
import { IProviders, ErrorHelper } from '../../transitional';
import { ICorporateLink } from '../../business/corporateLink';
import { Account } from '../../business/account';
import { sleep, asNumber } from '../../utils';
import { EventRecord } from '../../entities/events/eventRecord';
import { IGraphEntry, IGraphProvider } from '../../lib/graphProvider';

export const InterestingContributionEventTypesList = [
  'CommitCommentEvent',
  'IssueCommentEvent',
  'IssuesEvent',
  'PullRequestEvent',
  'PullRequestReviewEvent',
  'PullRequestReviewCommentEvent',
];

const DeletedAccounts = new Set<string>();

interface IGitHubEventBody {
  id: string;
  created_at: string;
  payload?: any;
  public?: boolean;
  type: string;
  repo?: {
    id: number;
    name: string;
    url: string;
  };
  actor?: {
    id: number;
    login: string;
    gravatar_id: string;
    avatar_url: string;
    url: string;
  };
  org?: {
    id: number;
    login: string;
    gravatar_id: string;
    avatar_url: string;
    url: string;
  };
}

interface IOpenEvent {
  isOpenSource: boolean; // "is this an open source contribution outside the corporation?"
  body: IGitHubEventBody;
}

const ignoredKeys = [
  '_links',
  'archived',
  'assignee',
  'assignees',
  'avatar_url',
  'base',
  'default_branch',
  'diff_hunk',
  'forks',
  'forks_count',
  'has_downloads',
  'has_issues',
  'has_pages',
  'has_projects',
  'has_wiki',
  'gravatar_id',
  'homepage',
  'in_reply_to_id',
  'original_commit_id',
  'original_position',
  'position',
  'path',
  'pull_request_review_id',
  'labels',
  'language',
  'maintainer_can_modify',
  'node_id',
  'open_issues',
  'open_issues_count',
  'size',
  'stargazers_count',
  'watchers',
  'watchers_count',
  'rebaseable',
  'requested_reviewers',
  'requested_teams',
  'site_admin',
  'url',
];

const seenForks = new Set<string>();

function distill(obj: any) {
  if (typeof(obj) == 'object') {
    const copy = stripUrls({...obj});
    for (const ik of ignoredKeys) {
      delete copy[ik];
    }
    for (const key in copy) {
      if (copy[key]) {
        copy[key] = distill(copy[key]);
      }
    }
    return copy;
  }
  return obj;
}

function strippedEventBody(body: IGitHubEventBody, payload: any, isOpenSource: boolean) {
  const copy = distill({...body, contribution: isOpenSource});
  delete copy.public;
  delete copy.payload;
  if (payload) {
    copy.payload = payload;
  }
  return copy;
}

function stripUrls(obj: any) {
  for (const key of Array.from(Object.getOwnPropertyNames(obj))) {
    if (key.endsWith('_url')) {
      delete obj[key];
    }
  }
  return obj;
}

function stripPayloadSize(type: string, payload: any) {
  payload = distill(payload);
  switch (type) {
    case 'CommitCommentEvent':
    case 'IssueCommentEvent': // storage note for this type... both issue and comment bodies will be stored
    case 'IssuesEvent':
    case 'PullRequestReviewCommentEvent': // body can get quite large
    // PullRequestReviewEvent : haven't seen live yet
    case 'PullRequestEvent': {
      return payload;
    }
    default: {
      console.log(`Strip function not implemented for type: ${type}`);
      console.dir(payload);
      return payload;
    }
  }
}

export function run(config: any, reclassify: boolean) {
  const app = require('../../app');
  config.skipModules = new Set([
    'web',
  ]);
  app.initializeJob(config, null, (error) => {
    if (error) {
      throw error;
    }
    learn(config, app, reclassify).then(done => {
      console.log('done');
      process.exit(0);
    }).catch(error => {
      throw error;
    });
  });
};

function isCorporateOrganization(
  organizationId: number | string, 
  organizationName: string, 
  corporateOrganizationIds: Set<number>,
  forcedOpenSourceOrgs: Set<string>,
  illegalCorporateOrgs: Set<string>
  ): boolean {
  if (organizationId && corporateOrganizationIds.has(asNumber(organizationId))) {
    if (organizationName && forcedOpenSourceOrgs.has(organizationName.toLowerCase())) {
      // forced open org
      console.log(`  forced kept open source: ${organizationName}`);
    } else {
      return true;
    }
  }
  if (organizationName && illegalCorporateOrgs.has(organizationName.toLowerCase())) {
    // known other corporate organization
    return true;
  }
  return false;
}

async function evaluateWhetherOpenSource(
  providers: IProviders, 
  repositoryId: string | number, 
  repositoryName: string, 
  organizationId: string | number, 
  organizationName: string, 
  account: Account, 
  corporateOrganizationIds: Set<number>,
  forcedOpenSourceOrgs: Set<string>,
  illegalCorporateOrgs: Set<string>
  ): Promise<boolean> {
  let isOpenSource = true;
  // contribution to yourself
  if (repositoryName &&  repositoryName.toLowerCase().startsWith(`${account.login}/`.toLowerCase())) {
    isOpenSource = false;
  }
  // corporate organization registered in this system
  if (isOpenSource && isCorporateOrganization(organizationId, organizationName, corporateOrganizationIds, forcedOpenSourceOrgs, illegalCorporateOrgs)) {
    isOpenSource = false;
  }
  if (isOpenSource && repositoryId) {
    // Check whether it is a fork of a corporate organization
    const strippedName = stripRepositoryName(repositoryName);
    const localOrganizationName = strippedName.orgName || organizationName;
    const organization = providers.operations.getUncontrolledOrganization(localOrganizationName, organizationId? asNumber(organizationId) : null);
    if (organization.uncontrolled) {
      if (!organization.id && !organizationName && localOrganizationName !== account.login.toLowerCase() && !DeletedAccounts.has(account.login.toLowerCase())) { 
        console.log('  new contribution to another user: ' + localOrganizationName);
        try {
          const otherAccount = await providers.operations.getAccountByUsername(localOrganizationName);
          const entity = otherAccount.getEntity();
          organization.id = otherAccount.id; // mark
          if (entity.name || entity.company || entity.location || entity.followers) {
            console.log(`  ${entity.name ? 'name=' + entity.name + ' ' : ''}${entity.company ? 'company=' + entity.company + ' ' : ''}${entity.location ? 'location=' + entity.location + ' ' : ''}${entity.location ? 'followers=' + entity.followers + ' ' : ''}`);
          }
        } catch (userError) {
          if (ErrorHelper.IsNotFound(userError)) {
            console.log(`  deleted GitHub user: ${localOrganizationName}`);
            DeletedAccounts.add(localOrganizationName);
          } else {
            console.dir(userError);
          }
        }
      }
      if (!organization.id && organizationName && localOrganizationName !== account.login.toLowerCase() && !DeletedAccounts.has(account.login.toLowerCase())) {
        console.log('  new uncontrolled org: ' + organizationName);
        try {
          await organization.getDetails();
        } catch (orgError) {
          if (ErrorHelper.IsNotFound(orgError)) {
            // likely a user!
          } else {
            console.dir(orgError);
          }
        }
      }
    }
    const repository = organization.repository(strippedName.repoName, { id: repositoryId });
    try {
      await repository.getDetails();
      if (repository.fork && repository.parent) {
        const parentOrganization = repository.parent.owner;
        const isCorporateParent = isCorporateOrganization(parentOrganization.id, parentOrganization.login, corporateOrganizationIds, forcedOpenSourceOrgs, illegalCorporateOrgs);
        const seen = seenForks.has(repository.full_name);
        if (isCorporateParent) {
          isOpenSource = false;
        }
        if (!seen) {
          console.log(isCorporateParent ? `repo ${repository.full_name} is a corporate fork for ${repository.parent.full_name}` : `fork: repository ${repository.full_name} is a fork of ${repository.parent.full_name}`);
          seenForks.add(repository.full_name);
        }
      }
    } catch (error) {
      if (ErrorHelper.IsNotFound(error)) {
        // ignore if the repository has since been deleted
      } else {
        console.dir(error);
      }
    }
  }
  return isOpenSource;
}

function stripRepositoryName(repositoryName: string) {
  const i = repositoryName.indexOf('/');
  let repoName = null;
  let orgName = null;
  if (i >= 0) {
    repoName = repositoryName.substr(i + 1).toLowerCase();
    orgName = repositoryName.substr(0, i).toLowerCase();
  } else {
    repoName = repositoryName.toLowerCase();
  }
  return { repoName, orgName };
}

async function learn(config, app, reclassify: boolean) : Promise<void> {
  const providers = app.settings.providers as IProviders;
  const { linkProvider, operations, eventRecordProvider, graphProvider } = providers;
  let forcedOpenSourceOrgs = new Set<string>();
  if (appPackage['contributions-official-overridden-organizations-require']) {
    forcedOpenSourceOrgs = new Set(require(appPackage['contributions-official-overridden-organizations-require']));
  }
  let illegalOrgs: string[] = [];
  if (appPackage['contributions-unofficial-organizations-require']) {
    illegalOrgs = require(appPackage['contributions-unofficial-organizations-require']);
  }
  const illegalCorporateOrgs = new Set(illegalOrgs);
  let allLinks = await getAllLinks(linkProvider);
  allLinks = _.shuffle(allLinks);
  console.log(reclassify ? 
    `reclassifying contributions for ${allLinks.length} links` : 
    `learning of recent contributions for ${allLinks.length} links...`);
  let errors = 0;
  let errorList = [];
  let participants = 0;
  const importantEventTypes = new Set(InterestingContributionEventTypesList);
  const collectedOrgs = new Set<string>();
  const corporateOrganizationIds = new Set(operations.getOrganizationIds());
  let insertedEvents = 0;
  let processedEvents = 0;
  let reclassifiedEvents = 0;
  let reclassifiedUsers = 0;
  let x = 0;
  let concurrency = reclassify ? 5 : 1;

  const throttle = throat(concurrency);
  await Promise.all(allLinks.map((link: ICorporateLink) => throttle(async () => {
    const i = ++x;
    try {
      const account = operations.getAccount(link.thirdPartyId);
      await account.getDetails();
      let management = undefined;
      if (reclassify) {
        const dateAWeekAgo = new Date((new Date()).getTime() - (1000 * 60 * 60 * 24 * 7));
        let touched = false;
        const existingEvents = await eventRecordProvider.queryEventsByThirdPartyId(account.id.toString());
        if (existingEvents.length) {
          console.log(`${i}: re-evaluating ${existingEvents.length} events`);
        }
        let noop = 0, newaction = 0;
        for (let j = 0; j < existingEvents.length; j++) {
          const event = existingEvents[j];
          const reclassified = event.additionalData.reclassified ? new Date(event.additionalData.reclassified) : null;
          if (reclassified > dateAWeekAgo) {
            ++noop;
            continue; // quick skip
          }
          const wasOpenSource = event.additionalData.contribution || false;
          if (management === undefined) {
            management = await getManagers(graphProvider, link);
          }
          if (!event.additionalData.management && management) {
            event.additionalData.management = management.map(entry => entry.id).reverse();
          } else if (management && event.additionalData.management) {
            console.log('could actually skip!');
          }
          // not actually reclassifying anything now!
          event.additionalData.reclassified = new Date();
          await eventRecordProvider.rewriteEvent(event);
          console.log(`\trewrote: event id=${event.eventId} with mgmt-info`);
          ++newaction;
          if (false) {
            // NO RE-EVAL NOW SINCE THIS IS JUST FOCUSED
            const newOpenSourceValue = await evaluateWhetherOpenSource(providers, event.repositoryId, event.repositoryName, event.organizationId, event.organizationName, account, corporateOrganizationIds, forcedOpenSourceOrgs, illegalCorporateOrgs);
            if (wasOpenSource !== newOpenSourceValue) {
              console.log(`Change from ${wasOpenSource} to ${newOpenSourceValue} for event ${event.eventId} repo: ${event.repositoryName}`);
              if (newOpenSourceValue === true) {
                console.log('Project went from closed to open recognition!');
              }
              event.additionalData.contribution = newOpenSourceValue;
              ++reclassifiedEvents;
              try {
                await eventRecordProvider.rewriteEvent(event);
                touched = true;
              } catch (rewriteError) {
                console.dir(rewriteError);
              }
            } else {
              await eventRecordProvider.rewriteEvent(event);
            }
          }
        }
        if (newaction || noop) {
          console.log('|'.repeat(newaction) + '.'.repeat(noop));
        }
        return;
        // continue;
      }

      let rawEvents = await account.getRecentEventsFirstPage();
      const cost = rawEvents['cost'];
      const headers = rawEvents['headers'];
      let refreshMorePages = true;
      if (cost && cost.github && cost.github.cacheHits > 0 && cost.github.usedApiTokens === 0) {
        // no change, do not get more events
        refreshMorePages = false;
        console.log(headers.link ? `${i}. no change, saved multiple calls` : `${i}. no change`);
      }
      if (refreshMorePages) {
        rawEvents = await account.getEvents();
      }
      if (refreshMorePages && rawEvents['cached'] === false) {
        console.log(`${i}. refreshed data`);
        await sleep(1500);
      } else if (refreshMorePages) {
        console.log(`${i}. valid cache`);
      }
      // types of things we filter out: creating a repo in your account; forking something; pushing code; watching something; joining an org in public
      let events: IOpenEvent[] = rawEvents.filter(entry => importantEventTypes.has(entry.type)).map(body => { return { isOpenSource: true, body } });
      let newOpenContributions = 0;
      for (let j = 0; j < events.length; j++) {
        ++processedEvents;
        const event = events[j];
        const body = event.body;
        let payload = null;
        if (body.org) {
          collectedOrgs.add(body.org.login);
        }
        try {
          const existingEventRecord = await eventRecordProvider.getEvent(body.id);
          if (existingEventRecord) {
            continue;
          }
        } catch (queryError) {
          if (ErrorHelper.IsNotFound(queryError)) {
            // has not yet been inserted yet, this is good...
          } else {
            console.dir(queryError);
            continue;
          }
        }
        if (body.payload) {
          payload = stripPayloadSize(body.type, body.payload);
        }
        // The event has not yet been stored
        const repositoryId = body.repo && body.repo.id ? body.repo.id : null;
        const repositoryName = body.repo && body.repo.name ? body.repo.name : null;
        const organizationId = body.org && body.org.id ? body.org.id : null;
        const organizationName = body.org && body.org.login ? body.org.login : null;
        const isOpenSource = await evaluateWhetherOpenSource(providers, repositoryId, repositoryName, organizationId, organizationName, account, corporateOrganizationIds, forcedOpenSourceOrgs, illegalCorporateOrgs);
        if (isOpenSource) {
          ++newOpenContributions;
        }
        try {
          const record = new EventRecord();
          record.created = new Date(body.created_at);
          record.eventId = body.id;
          record.inserted = new Date();
          record.action = body.type;
          if (body.org) {
            record.organizationId = body.org.id.toString();
            record.organizationName = body.org.login;
          }
          if (body.repo) {
            record.repositoryId = body.repo.id.toString();
            record.repositoryName = body.repo.name;
          }
          record.userCorporateId = link.corporateId;
          record.userCorporateUsername = link.corporateUsername;
          record.userId = link.thirdPartyId;
          record.userUsername = link.thirdPartyUsername;
          record.additionalData = strippedEventBody(body, payload, isOpenSource);
          if (management === undefined) {
            management = await getManagers(graphProvider, link);
          }
          if (management) {
            record.additionalData.management = management.map(entry => entry.id).reverse();
          }
          await eventRecordProvider.insertEvent(record);
          ++insertedEvents;
        } catch (insertError) {
          if (ErrorHelper.IsConflict(insertError)) {
            // already exists
            continue;
          }
          console.dir(insertError);
          continue;
        }
      }
      if (newOpenContributions) {
        ++participants;
        console.log(`total inserted new contribution users: ${participants} at ${i}/${allLinks.length} (excludes existing known events)`);
      }
    } catch (error) {
      if (ErrorHelper.IsNotFound(error)) {
        console.log('Deleted/former GitHub offering');
        return;
        // continue;
      }
      console.log('Issue with entry:');
      console.dir(link);
      console.warn(error);
      ++errors;
      errorList.push(error);
      await sleep(10*1000);
    }
  })));
  console.log(`Inserted ${insertedEvents} new events, processed ${processedEvents} overall events returned from GitHub APIs`);
  if (reclassify) {
    console.log(`RECLASSIFIED ${reclassifiedEvents} events for ${reclassifiedUsers} distinct users`);
  }
  console.log('All done with ' + errors + ' errors');
  console.dir(errorList);
  console.log();

  console.log('---------------- Organizations contributed to -------------------');
  const orgs = Array.from(collectedOrgs.values()).sort();
  orgs.map(org => console.log(org));
  console.log('-----------------------------------------------------------------');
}

async function getAllLinks(linkProvider: ILinkProvider) : Promise<ICorporateLink[]> {
  return linkProvider.getAll();
}

async function getManagers(graphProvider: IGraphProvider, link: ICorporateLink) {
  let management: IGraphEntry[] = null;
  try {
    management = await graphProvider.getManagementChain(link.corporateId);
    if (!management) {
      console.log(`WARNING: this person may no longer be at Microsoft: ${link.corporateDisplayName} / ${link.corporateUsername}`);
    }
    return management;
  } catch (getGraphInformation) {
    console.dir(getGraphInformation);
  }
}
