//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

const _ = require('lodash');
const repoSearch = require('../business/repoSearch');

function sortOrgs(orgs) {
  return _.sortBy(orgs, ['name']);
}

function getRepos(crossOrgOrOrgName, operations, callback) {
  if (crossOrgOrOrgName) {
    return operations.getOrganization(crossOrgOrOrgName).getRepositories(callback);
  } else {
    return operations.getRepos(callback);
  }
}

function getReposAndOptionalTeamPermissions(orgName, operations, githubId, teamsType, team2, specificTeamRepos, callback) {
  getRepos(orgName, operations, (error, reposData, ageInformation) => {
    if (error) {
      return callback(error);
    }
    if (!teamsType || teamsType === 'all') {
      // Retrieve the repositories for this specific repo, along with permissions information
      // NOTE: This means that for now the filtering of permissions won't work in specific team mode
      if (team2 && specificTeamRepos) {
        const repoOptions = {
          'type': 'sources',
        };
        return team2.getRepositories(repoOptions, (getRepositoriesError, repositories) => {
          return getRepositoriesError ? callback(getRepositoriesError) : callback(null, reposData, ageInformation, null, null, repositories);
        });
      } else {
        return callback(null, reposData, ageInformation);
      }
    }
    // Need to retrieve cached team permissions information to pass to the search routines
    operations.graphManager.getReposWithTeams((gmError, repoPermissions) => {
      if (gmError) {
        return callback(gmError);
      }
      let options = {};
      operations.graphManager.getUserReposByTeamMemberships(githubId, options, (userReposError, userRepos) => {
        if (userReposError) {
          return callback(userReposError);
        }
        return callback(null, reposData, ageInformation, repoPermissions, userRepos);
      });
    });
  });
}

module.exports = (req, res, next) => {
  const isCrossOrg = req.reposPagerMode === 'orgs';
  let teamsType = req.query.tt;
  const orgName = isCrossOrg ? null : req.organization.name.toLowerCase();

  // Filter by team repositories, only in sub-team views
  const specificTeamPermissions = req.teamPermissions;
  const team2 = req.team2;
  let specificTeamId = team2 ? team2.id : null;

  const operations = req.app.settings.operations;

  getReposAndOptionalTeamPermissions(orgName, operations, req.legacyUserContext.id.github, teamsType, team2, specificTeamId, (error, reposData, ageInformation, repoPermissions, userRepos, specificRepositories) => {
    if (error) {
      return next(error);
    }
    const page = req.query.page_number ? req.query.page_number : 1;
    let phrase = req.query.q;

    // TODO: Validate the type
    let type = req.query.type;
    if (type !== 'public' && type !== 'private' & type !== 'source' && type !== 'fork' /*&& type !== 'mirrors' - we do not do mirror stuff */) {
      type = null;
    }

    let showIds = req.query.showids === '1';

    let teamsSubType = null;
    if (teamsType !== 'teamless' && teamsType !== 'myread' && teamsType !== 'mywrite' && teamsType !== 'myadmin') {
      teamsType = null;
    } else if (teamsType === 'myread' || teamsType === 'mywrite' || teamsType === 'myadmin') {
      teamsSubType = teamsType.substr(2);
      teamsType = 'my';
    }

    // TODO: Validate the language value is in the Linguist list
    let language = req.query.language;

    const filters = [];
    if (type) {
      filters.push({
        type: 'type',
        value: type,
        displayValue: type === 'fork' ? 'forked' : type,
        displaySuffix: 'repositories',
      });
    }
    if (phrase) {
      filters.push({
        type: 'phrase',
        value: phrase,
        displayPrefix: 'matching',
      });
    }
    if (language) {
      filters.push({
        type: 'language',
        value: language,
        displayPrefix: 'written in',
      });
    }
    if (teamsType) {
      let ttValue = teamsType === 'my' ? 'my ' + teamsSubType : teamsType;
      if (teamsType === 'teamless') {
        ttValue = 'no';
      }
      filters.push({
        type: 'tt',
        value: ttValue,
        displayPrefix: 'and',
        displaySuffix: 'team permissions',
      });
    }

    const search = new repoSearch(reposData, {
      phrase: phrase,
      language: language,
      type: type,
      teamsType: teamsType,
      specificTeamRepos: specificRepositories,
      specificTeamPermissions: specificTeamPermissions,
      teamsSubType: teamsSubType,
      repoPermissions: repoPermissions,
      userRepos: userRepos,
      graphManager: req.app.settings.operations.graphManager,
    });

    search.search(null, page, req.query.sort, false /* false == show private repos */)
    .then(() => {
      req.legacyUserContext.render(req, res, 'repos/', 'Repos', {
        organizations: isCrossOrg ? sortOrgs(operations.getOrganizations(operations.organizationNames)) : undefined,
        organization: isCrossOrg ? undefined : req.organization,
        search: search,
        filters: filters,
        query: {
          phrase: phrase,
          type: type,
          language: language,
          tt: teamsType ? req.query.tt : null,
        },
        reposDataAgeInformation: ageInformation,
        specificTeamPermissions: specificTeamPermissions,
        specificTeam: team2,
        teamUrl: req.teamUrl,
        showIds: showIds,
      });
    }).catch(next);
  });
};
