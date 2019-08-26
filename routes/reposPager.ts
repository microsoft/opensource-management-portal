//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

import asyncHandler from 'express-async-handler';
import express from 'express';
import _ from 'lodash';

import { IReposAppWithTeam } from '../transitional';
import { Operations } from '../business/operations';
import { Repository } from '../business/repository';
import { Team, GitHubRepositoryType } from '../business/team';
import { RepositorySearch } from '../business/repoSearch';

interface IGetReposAndOptionalTeamPermissionsResponse {
  reposData: Repository[];
  ageInformation?: any;
  repoPermissions?: any;
  userRepos?: any;
  specificTeamRepos?: Repository[],
}

function sortOrgs(orgs) {
  return _.sortBy(orgs, ['name']);
}

function getRepos(crossOrgOrOrgName, operations: Operations): Promise<Repository[]> {
  if (crossOrgOrOrgName) {
    return operations.getOrganization(crossOrgOrOrgName).getRepositories();
  } else {
    return operations.getRepos();
  }
}

async function getReposAndOptionalTeamPermissions(orgName: string, operations: Operations, githubId: string, teamsType: string | null | undefined, team2: Team, specificTeamRepos): Promise<IGetReposAndOptionalTeamPermissionsResponse> {
  // REMOVED: previously age information was avialable via getRepos(orgName, operations, (error, reposData, ageInformation). Was it really useful?
  const reposData = await getRepos(orgName, operations);
  if (!teamsType || teamsType === 'all') {
    // Retrieve the repositories for this specific repo, along with permissions information
    // NOTE: This means that for now the filtering of permissions won't work in specific team mode
    if (team2 && specificTeamRepos) {
      const repoOptions = {
        type: GitHubRepositoryType.Sources,
      };
      return { reposData, specificTeamRepos: await team2.getRepositories(repoOptions) };
    } else {
      return { reposData }; // return callback(null, reposData, ageInformation);
    }
  }
  // Need to retrieve cached team permissions information to pass to the search routines
  const repoPermissions = await operations.graphManager.getReposWithTeams();
  let options = {};
  const userRepos = await operations.graphManager.getUserReposByTeamMemberships(githubId, options);
  return { reposData, repoPermissions, userRepos };
}

module.exports = asyncHandler(async function(req: IReposAppWithTeam, res: express.Response, next: express.NextFunction) {
  const operations = req.app.settings.operations as Operations;
  const isCrossOrg = req.reposPagerMode === 'orgs';
  let teamsType = req.query.tt;
  const orgName = isCrossOrg ? null : req.organization.name.toLowerCase();
  // Filter by team repositories, only in sub-team views
  const specificTeamPermissions = req.teamPermissions;
  const team2 = req.team2;
  let specificTeamId = team2 ? team2.id : null;
  const gitHubId = req.individualContext.getGitHubIdentity().id;
  const { reposData, repoPermissions, userRepos, specificTeamRepos /*, ageInformation */ } = await getReposAndOptionalTeamPermissions(orgName, operations, gitHubId, teamsType, team2, specificTeamId);

  const page = req.query.page_number ? req.query.page_number : 1;

  let phrase = req.query.q;

  // TODO: Validate the type
  let type = req.query.type;
  if (type !== 'public' && type !== 'private' && type !== 'source' && type !== 'fork' /*&& type !== 'mirrors' - we do not do mirror stuff */) {
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

  const search = new RepositorySearch(reposData, {
    phrase,
    language,
    type,
    teamsType,
    specificTeamRepos,
    specificTeamPermissions,
    teamsSubType,
    repoPermissions,
    userRepos,
    graphManager: operations.graphManager,
  });

  await search.search(page, req.query.sort);

  req.individualContext.webContext.render({
    view: 'repos/',
    title: 'Repos',
    state: {
      organizations: isCrossOrg ? sortOrgs(operations.getOrganizations(operations.organizationNames)) : undefined,
      organization: isCrossOrg ? undefined : req.organization,
      search,
      filters,
      query: {
        phrase,
        type,
        language,
        tt: teamsType ? req.query.tt : null,
      },
      reposDataAgeInformation: null, // ageInformation, // TODO: can 'ageInformation' be recovered?
      specificTeamPermissions,
      specificTeam: team2,
      teamUrl: req.teamUrl,
      showIds,
    },
  });
});
