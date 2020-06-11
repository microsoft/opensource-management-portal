//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import express from 'express';
import asyncHandler from 'express-async-handler';
const router = express.Router();

import groupBy from 'lodash/groupBy';
import sortBy from 'lodash/sortBy';

import FossFundRoute from './fossfund';

import { AuthorizeOnlyCorporateAdministrators } from '../../middleware/business/corporateAdministrators';
import { ReposAppRequest, IProviders, ErrorHelper } from '../../transitional';
import { EventRecord } from '../../entities/events/eventRecord';
import { AuthorizeOnlyFullTimeEmployeesAndInterns, isEmployeeOrIntern } from '../../middleware/business/employeesOnly';
import { getOffsetMonthRange } from '../../utils';
import { FossFundElection } from '../../features/fossFundElection';
import { utils } from 'mocha';

interface IContributionsRequest extends ReposAppRequest {
  contributions?: EventRecord[];
  previousContributions?: EventRecord[];
  contributionsLogin?: string;
  electionsSystem?: FossFundElection;
  linkCreated: Date;
}

interface IContributionsDocument {
  contributions: EventRecord[];
}

const hardcodedDisplayMap = {
  PullRequestEvent: 'Pull requests',
  IssuesEvent: 'Issues',
  IssueCommentEvent: 'Issue comments',
  CommitCommentEvent: 'Commit comments',
  PullRequestReviewEvent: 'Pull request reviews',
  PullRequestReviewCommentEvent: 'Pull request comments',
};

router.use('/voting', AuthorizeOnlyFullTimeEmployeesAndInterns, FossFundRoute);

router.get('/popular', AuthorizeOnlyCorporateAdministrators, asyncHandler(async (req: ReposAppRequest, res, next)  => {
  const providers = req.app.settings.providers as IProviders;
  const { start, end } = getOffsetMonthRange();
  const data = await providers.eventRecordProvider.queryPopularContributions(start, end);
  req.individualContext.webContext.render({
    view: 'contributions/popular',
    title: `CONFIDENTIAL - Popular repos to contribute to`,
    state: {
      start,
      end,
      data,
    },
  });
}));

router.get('/eligibility', AuthorizeOnlyCorporateAdministrators, asyncHandler(async (req: ReposAppRequest, res, next)  => {
  const providers = req.app.settings.providers as IProviders;
  const monthOffset = req.query.prior ? -1 : 0;
  const { start, end } = getOffsetMonthRange(monthOffset);
  const thirdPartyIds = new Set(await providers.eventRecordProvider.queryDistinctEligibleContributors(start, end));
  const links = (await providers.linkProvider.getAll()).filter(link => thirdPartyIds.has(link.thirdPartyId) && !link.isServiceAccount);
  const vendors = links.filter(link => link.corporateUsername.indexOf('-') === 1);
  const employees = links.filter(link => link.corporateUsername.indexOf('-') === -1);
  const sorted = sortBy(employees, 'corporateDisplayName');
  const columnCount = 3;
  req.individualContext.webContext.render({
    view: 'contributions/eligible',
    title: `CONFIDENTIAL - Eligible open source contributors from ${start} to ${end}`,
    state: {
      start,
      end,
      vendorCount: vendors.length,
      count: sorted.length,
      eligibleByColumn: [...Array(columnCount).keys()].map(c => sorted.filter((_, i) => i % columnCount === c)),
    },
  });}));

router.use(asyncHandler(async (req: IContributionsRequest, res, next) => {
  req.reposContext = {
    section: 'contributions',
  };

  const providers = req.app.settings.providers as IProviders;
  let { id, username } = req.individualContext.getGitHubIdentity();
  
  let link = req.individualContext.link;
  const otherUser = req.query.login;
  if (otherUser) {
    try {
      link = await providers.linkProvider.getByThirdPartyUsername(otherUser);
      if (link) {
        username = otherUser;
        id = link.thirdPartyId;
      }
    } catch (error) {
      return next(ErrorHelper.IsNotFound(error) ? new Error(`User not linked: ` + otherUser) : error);
    }
  }

  if (link && link['created']) {
    req.linkCreated = link['created'];
  }

  if (req.query.refresh) {
    await refreshMonthContributions(providers, id);
  }

  const document = await getMonthContributions(providers, id, 0);
  req.contributions = document && document.contributions ? document.contributions : [];
  const previousDocument = await getMonthContributions(providers, id, -1);
  req.previousContributions = previousDocument && previousDocument.contributions ? previousDocument.contributions : [];
  req.contributionsLogin = username;

  try {
    req.electionsSystem = new FossFundElection(providers);
  } catch (electionsIgnore) {
    console.log(electionsIgnore);
  }

  return next();
}));

async function showContributions(req: IContributionsRequest, monthOffset: number): Promise<void> {
  const username = req.contributionsLogin;
  const isEmployee = isEmployeeOrIntern(req.individualContext.corporateIdentity.username);
  const isSelf = username.toLowerCase() === req.individualContext.getGitHubIdentity().username.toLowerCase();
  const isOtherEventsDisplay = req.query['other'] === '1';
  const isTruncating = req.query['all'] !== '1';
  if (monthOffset && monthOffset !== -1) {
    throw new Error('Unsupported month offset value');
  }
  const { start, end } = getOffsetMonthRange(monthOffset);
  let eligibleStartMonths = [];
  let elections = [];
  if (req.electionsSystem) {
    const thisMonth = getOffsetMonthRange(0);
    const lastMonth = getOffsetMonthRange(-1);
    elections.push(... await req.electionsSystem.getElectionsByEligibilityDates(lastMonth.start, lastMonth.end));
    elections.push(... await req.electionsSystem.getElectionsByEligibilityDates(thisMonth.start, thisMonth.end));
    const thisMonthOpenContributions = req.contributions.filter(event => event.isOpenContribution || event.additionalData.contribution);
    if (thisMonthOpenContributions.length > 0) {
      eligibleStartMonths.push(thisMonth.start.toISOString());
    }
    const lastMonthOpenContributions = req.previousContributions.filter(event => event.isOpenContribution || event.additionalData.contribution);
    if (lastMonthOpenContributions.length > 0) {
      eligibleStartMonths.push(lastMonth.start.toISOString());
    }
  }
  let offsetContributions = monthOffset === -1 ? req.previousContributions : req.contributions;
  offsetContributions = offsetContributions || [];
  let contributedLastMonth = false;
  if (!monthOffset) {
    const lastMonthOpenContributions = req.previousContributions.filter(event => event.isOpenContribution || event.additionalData.contribution);
    if (lastMonthOpenContributions.length) {
      contributedLastMonth = true;
    }
  }
  const openContributions = offsetContributions.filter(event => event.isOpenContribution ||event.additionalData.contribution);
  const otherContributionsData = offsetContributions.filter(event => !(event.isOpenContribution || event.additionalData.contribution));
  const contributions = groupBy(openContributions, contrib => contrib.action);
  const otherContributions = groupBy(otherContributionsData, contrib => contrib.action);
  const linkCreated = req.linkCreated;
  let recentlyLinked = false;
  if (linkCreated) {
    const now = new Date();
    if (linkCreated > new Date(now.getTime() - (1000 * 60 * 60 * 24 * 2))) {
      recentlyLinked = true;
    }
  }

  req.individualContext.webContext.render({
    view: 'contributions',
    title: `GitHub contributions made by ${username}`,
    state: {
      start,
      end,
      prior: monthOffset === -1 ? true : false,
      contributedLastMonth,
      login: username,
      isOtherEventsDisplay,
      isSelf,
      contributionTypes: Object.getOwnPropertyNames(hardcodedDisplayMap),
      contributionDescriptions: hardcodedDisplayMap,
      contributions,
      contributionCount: openContributions.length,
      otherContributions,
      otherContributionsCount: otherContributionsData.length,
      isTruncating,
      elections,
      electionsSystem: req.electionsSystem,
      eligibleStartMonths,
      isEmployee,
      recentlyLinked,
    },
  });
}

// The contributions page can be shown to any user, but not the nomination experience.

router.get('/', asyncHandler(async (req: IContributionsRequest, res, next) => {
  await showContributions(req, req.query.prior ? -1 : 0);
}));

async function refreshMonthContributions(providers: IProviders, thirdPartyId: string, offsetMonths?: number): Promise<void> {
  const account = providers.operations.getAccount(thirdPartyId);
  await account.getDetails();
  await account.getEvents({ 
    backgroundRefresh: false,
    maxAgeSeconds: 0,
  });
  const { start, end } = getOffsetMonthRange(offsetMonths);
  const key = `contributions:${thirdPartyId}:all:${start.toISOString()}:${end.toISOString()}`;
  await providers.cacheProvider.delete(key);
}

async function getMonthContributions(providers: IProviders, thirdPartyId: string, offsetMonth: number): Promise<IContributionsDocument> {
  const { start, end } = getOffsetMonthRange(offsetMonth);
  const key = `contributions:${thirdPartyId}:all:${start.toISOString()}:${end.toISOString()}`;
  let contributions = await providers.cacheProvider.getObject(key) as IContributionsDocument;
  if (contributions) {
    return contributions;
  }
  const records  = await providers.eventRecordProvider.queryOpenContributionEventsByDateRangeAndThirdPartyId(
    thirdPartyId,
    start,
    end,
    false /* do not only limit to open contributions */);
  const ttlMinutes = records.length ? 15 : 1;
  await providers.cacheProvider.setObjectWithExpire(key, { contributions: records }, ttlMinutes);
  return { contributions: records || [] };
}

module.exports = router;
