//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import _ from 'lodash';
import { NextFunction, Response } from 'express';

import { CreateError, getProviders } from '../lib/transitional.js';
import { Operations } from '../business/index.js';
import { Team } from '../business/index.js';
import { UserContext } from '../business/user/aggregate.js';

import TeamSearch from '../business/teamSearch.js';
import { ICrossOrganizationMembershipByOrganization, ReposAppRequest } from '../interfaces/index.js';

function sortOrgs(orgs) {
  return _.sortBy(orgs, ['name']);
}

interface IGetTeamsDataResults {
  teams: Team[];
  yourTeamsMap: Map<string, string>;
  totalMemberships: number;
  totalMaintainerships: number;
}

async function getTeamsData(
  singleOrganizationName: string | null,
  operations: Operations,
  userContext: UserContext
): Promise<IGetTeamsDataResults> {
  const options = {
    backgroundRefresh: true,
    maxAgeSeconds: 60 * 10 /* 10 minutes */,
    individualMaxAgeSeconds: 60 * 30 /* 30 minutes */,
  };
  let list: Team[] = null;
  if (singleOrganizationName) {
    const organization = operations.getOrganization(singleOrganizationName);
    list = await organization.getTeams(options);
  } else {
    list = [];
    const crossOrgTeams = await operations.getCrossOrganizationTeams(options);
    const allReducedTeams = Array.from(crossOrgTeams.values());
    allReducedTeams.forEach((reducedTeam: ICrossOrganizationMembershipByOrganization) => {
      const orgs = Object.getOwnPropertyNames(reducedTeam.orgs);
      const firstOrg = orgs[0];
      const organization = operations.getOrganization(firstOrg);
      const entry = organization.teamFromEntity(reducedTeam.orgs[firstOrg]);
      list.push(entry);
    });
  }

  const yourTeamsMap = new Map();
  const overview = await userContext.getAggregatedOverview();
  if (overview.teams && (overview.teams.member.length || overview.teams.maintainer.length)) {
    reduceTeams(overview.teams, 'member', yourTeamsMap);
    reduceTeams(overview.teams, 'maintainer', yourTeamsMap);
  }
  return {
    teams: list,
    yourTeamsMap,
    totalMemberships: overview.teams && overview.teams.member ? overview.teams.member.length : 0,
    totalMaintainerships: overview.teams && overview.teams.maintainer ? overview.teams.maintainer.length : 0,
  };
}

function reduceTeams(collections, property, map) {
  if (!collections) {
    return;
  }
  const values = collections[property];
  values.forEach((team) => {
    map.set(team.id, property);
  });
}

export default async function (req: ReposAppRequest, res: Response, next: NextFunction) {
  const { operations } = getProviders(req);
  const isCrossOrg = req.teamsPagerMode === 'orgs';
  const aggregations = req.individualContext.aggregations;
  const orgName = isCrossOrg ? null : req.organization.name.toLowerCase();
  const { teams, yourTeamsMap, totalMemberships, totalMaintainerships } = await getTeamsData(
    isCrossOrg ? null : orgName.toLowerCase(),
    operations,
    aggregations
  );
  let page = 1;
  if (req.query.page_number !== undefined) {
    if (typeof req.query.page_number !== 'string') {
      return next(CreateError.InvalidParameters('page_number must be a string'));
    }
    page = parseInt(req.query.page_number, 10);
    if (isNaN(page) || page <= 0) {
      return next(CreateError.InvalidParameters('page_number must be a positive number'));
    }
  }
  if (req.query.q !== undefined && typeof req.query.q !== 'string') {
    return next(CreateError.InvalidParameters('q must be a string'));
  }
  const phrase = req.query.q as string;
  if (req.query.set !== undefined && typeof req.query.set !== 'string') {
    return next(CreateError.InvalidParameters('set must be a string'));
  }
  let set = req.query.set as string;
  if (set !== 'all' && set !== 'available' && set !== 'your') {
    set = 'all';
  }
  if (req.query.sort !== undefined && typeof req.query.sort !== 'string') {
    return next(CreateError.InvalidParameters('sort must be a string'));
  }
  const sort = typeof req.query.sort === 'string' ? req.query.sort : null;
  const filters = [];
  if (phrase) {
    filters.push({
      type: 'phrase',
      value: phrase,
      displayPrefix: 'matching',
    });
  }
  const search = new TeamSearch(teams, {
    phrase: phrase,
    set: set,
    yourTeamsMap: yourTeamsMap,
  });
  await search.search(page, sort);
  const onboardingOrJoining = req.query.joining || req.query.onboarding;
  req.individualContext.webContext.render({
    view: 'teams/',
    title: 'Teams',
    state: {
      organizations: isCrossOrg
        ? sortOrgs(operations.getOrganizations(operations.organizationNames))
        : undefined,
      organization: isCrossOrg ? undefined : req.organization,
      search,
      filters,
      query: {
        phrase,
        set,
      },
      yourTeamsMap,
      totalMemberships,
      onboarding: req.query.onboarding,
      totalMaintainerships,
      errorAsWarning: null, // warning /* if an error occurs that is not fatal, we may want to display information about it */,
      onboardingOrJoining,
    },
  });
}
