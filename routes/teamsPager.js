//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

const _ = require('lodash');
const TeamSearch = require('../business/teamSearch');

function sortOrgs(orgs) {
  return _.sortBy(orgs, ['name']);
}

function getTeamsData(id, crossOrgOrOrgName, operations, callback) {
  const options = {
    backgroundRefresh: true,
    maxAgeSeconds: 60 * 10 /* 10 minutes */,
    individualMaxAgeSeconds: 60 * 30 /* 30 minutes */,
  };
  operations.getTeams(crossOrgOrOrgName, options, (error, teams) => {
    if (error) {
      return callback(error);
    }
    const input = Array.isArray(teams) ? teams : Array.from(teams.values());
    const list = [];
    input.forEach(team => {
      let entry = team;
      // Cross-organization entries need to be massaged
      if (team.orgs && !team.organization) {
        const orgs = Object.getOwnPropertyNames(team.orgs);
        const firstOrg = orgs[0];
        entry = team.orgs[firstOrg];
        entry.organization = {
          login: firstOrg,
        };
      }
      list.push(entry);
    });

    const yourTeamsMap = new Map();
    operations.getUserContext(id).getAggregatedOverview((overviewWarning, overview) =>
    {
      if (overviewWarning) {
        // TODO: What to show here?
        return callback(null, list, yourTeamsMap, null, null, overviewWarning /* warning */);
      }
      reduceTeams(overview.teams, 'member', yourTeamsMap);
      reduceTeams(overview.teams, 'maintainer', yourTeamsMap);
      return callback(null, list, yourTeamsMap, overview.teams && overview.teams.member ? overview.teams.member.length : 0, overview.teams && overview.teams.maintainer ? overview.teams.maintainer.length : 0);
    });
  });
}

function reduceTeams(collections, property, map) {
  if (!collections) {
    return;
  }
  const values = collections[property];
  values.forEach(team => {
    map.set(team.id, property);
  });
}

module.exports = (req, res, next) => {
  const operations = req.app.settings.operations;
  const isCrossOrg = req.teamsPagerMode === 'orgs';
  const id = req.legacyUserContext.id.github;
  const orgName = isCrossOrg ? null : req.organization.name.toLowerCase();
  getTeamsData(id, isCrossOrg ? null : orgName.toLowerCase(), operations, (error, teams, yourTeamsMap, totalMemberships, totalMaintainerships, warning) => {
    if (error) {
      return next(error);
    }
    const page = req.query.page_number ? req.query.page_number : 1;
    let phrase = req.query.q;

    let set = req.query.set;
    if (set !== 'all' && set !== 'available' && set !== 'your') {
      set = 'all';
    }

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
    search.search(null, page, req.query.sort).then(() => {
      const onboardingOrJoining = req.query.joining || req.query.onboarding;
      req.legacyUserContext.render(req, res, 'teams/', 'Teams', {
        organizations: isCrossOrg ? sortOrgs(operations.getOrganizations(operations.organizationNames)) : undefined,
        organization: isCrossOrg ? undefined : req.organization,
        search: search,
        filters: filters,
        query: {
          phrase: phrase,
          set: set,
        },
        yourTeamsMap: yourTeamsMap,
        totalMemberships: totalMemberships,
        totalMaintainerships: totalMaintainerships,
        errorAsWarning: warning /* if an error occurs that is not fatal, we may want to display information about it */,
        onboardingOrJoining: onboardingOrJoining,
      });
    }).catch(next);
  });
};
