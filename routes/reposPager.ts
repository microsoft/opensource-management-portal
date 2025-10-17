//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { NextFunction, Response } from 'express';
import _ from 'lodash';

import { daysInMilliseconds } from '../lib/utils.js';
import {
  Repository,
  IPersonalizedUserAggregateRepositoryPermission,
  TeamRepositoryPermission,
  Operations,
  Team,
  Organization,
  RepositorySearch,
} from '../business/index.js';
import QueryCache from '../business/queryCache.js';
import { GitHubRepositoryType, IReposAppWithTeam } from '../interfaces/index.js';
import { IRequestTeamPermissions } from '../middleware/github/teamPermissions.js';
import { CreateError, getProviders } from '../lib/transitional.js';
import { UserContext } from '../business/user/aggregate.js';

interface IGetReposAndOptionalTeamPermissionsResponse {
  reposData: Repository[];
  ageInformation?: any;
  userRepos?: IPersonalizedUserAggregateRepositoryPermission[];
  specificTeamRepos?: TeamRepositoryPermission[];
}

function sortOrgs(orgs) {
  return _.sortBy(orgs, ['name']);
}

async function getRepos(
  organizationId: number,
  operations: Operations,
  queryCache: QueryCache
): Promise<Repository[]> {
  if (organizationId) {
    if (queryCache && queryCache.supportsRepositories) {
      return (await queryCache.organizationRepositories(organizationId.toString())).map(
        (wrapper) => wrapper.repository
      );
    } else {
      return operations.getOrganizationById(organizationId).getRepositories();
    }
  } else {
    if (queryCache && queryCache.supportsRepositories) {
      return (await queryCache.allRepositories()).map((wrapper) => wrapper.repository);
    }
    return operations.getRepos();
  }
}

async function getReposAndOptionalTeamPermissions(
  organizationId: number,
  operations: Operations,
  queryCache: QueryCache,
  teamsType: string | null | undefined,
  team2: Team,
  specificTeamRepos,
  userContext: UserContext
): Promise<IGetReposAndOptionalTeamPermissionsResponse> {
  // REMOVED: previously age information was available via getRepos(orgName, operations, (error, reposData, ageInformation). Was it really useful?
  const reposData = await getRepos(organizationId, operations, queryCache);
  if (!teamsType || teamsType === 'all') {
    // Retrieve the repositories for this specific repo, along with permissions information
    // NOTE: This means that for now the filtering of permissions won't work in specific team mode
    if (team2 && specificTeamRepos) {
      const repoOptions = {
        type: GitHubRepositoryType.Sources,
      };
      return { reposData, specificTeamRepos: await team2.getRepositories(repoOptions) };
    } else {
      return { reposData };
    }
  }
  const userRepos = await userContext.repositoryPermissions();
  return { reposData, userRepos };
}

export default async function (req: IReposAppWithTeam, res: Response, next: NextFunction) {
  const providers = getProviders(req);
  const operations = providers.operations;
  const queryCache = providers.queryCache;
  const individualContext = req.individualContext;
  const isCrossOrg = req.reposPagerMode === 'orgs';
  let teamsType = req.query.tt as string;
  const organization = req.organization as Organization;
  const organizationId = isCrossOrg ? null : organization.id;
  // Filter by team repositories, only in sub-team views
  const specificTeamPermissions = req.teamPermissions as IRequestTeamPermissions;
  const team2 = req.team2 as Team;
  const specificTeamId = team2 ? team2.id : null;
  const { reposData, userRepos, specificTeamRepos } = await getReposAndOptionalTeamPermissions(
    organizationId,
    operations,
    queryCache,
    teamsType,
    team2,
    specificTeamId,
    individualContext.aggregations
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
  if (req.query.sort && typeof req.query.sort !== 'string') {
    return next(CreateError.InvalidParameters('sort must be a string'));
  }
  const sort = typeof req.query.sort === 'string' ? req.query.sort : null;
  if (req.query.type && typeof req.query.type !== 'string') {
    return next(CreateError.InvalidParameters('type must be a string'));
  }
  const type = typeof req.query.type === 'string' ? req.query.type : null;
  if (
    type &&
    type !== 'public' &&
    type !== 'private' &&
    type !== 'source' &&
    type !== 'fork' /*&& type !== 'mirrors' - we do not do mirror stuff */
  ) {
    return next(CreateError.InvalidParameters('type must be one of: public, private, source, fork'));
  }

  let metadataType = typeof req.query.mt === 'string' ? req.query.mt : null;
  if (
    metadataType !== 'with-metadata' &&
    metadataType !== 'without-metadata' &&
    metadataType !== 'administrator-locked' &&
    metadataType !== 'locked' &&
    metadataType !== 'unlocked'
  ) {
    metadataType = null;
  }

  const createdSinceValue = typeof req.query.cs === 'string' ? Number(req.query.cs) : null;
  let createdSince = null;
  if (createdSinceValue) {
    createdSince = new Date(new Date().getTime() - daysInMilliseconds(createdSinceValue));
  }

  const showIds = req.query.showids === '1';

  let teamsSubType = null;
  if (teamsType !== 'myread' && teamsType !== 'mywrite' && teamsType !== 'myadmin') {
    teamsType = null;
  } else if (teamsType === 'myread' || teamsType === 'mywrite' || teamsType === 'myadmin') {
    teamsSubType = teamsType.substr(2);
    teamsType = 'my';
  }
  if (req.query.language !== undefined && typeof req.query.language !== 'string') {
    return next(CreateError.InvalidParameters('language must be a string'));
  }
  // TODO: Validate the language value is in the Linguist list
  const language = req.query.language as string;

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
    const ttValue = teamsType === 'my' ? 'my ' + teamsSubType : teamsType;
    filters.push({
      type: 'tt',
      value: ttValue,
      displayPrefix: 'and',
      displaySuffix: 'team permissions',
    });
  }
  if (createdSince) {
    filters.push({
      type: 'cs',
      value: `${createdSinceValue} days`,
      displayPrefix: 'created within',
    });
  }
  if (metadataType) {
    const mtValue = metadataType.replace('-', ' ');
    filters.push({
      type: 'mt',
      value: mtValue,
    });
  }

  const search = new RepositorySearch(reposData, {
    phrase,
    language,
    type,
    teamsType,
    metadataType,
    specificTeamRepos,
    specificTeamPermissions,
    createdSince,
    teamsSubType,
    userRepos,
    graphManager: operations.graphManager,
    repositoryMetadataProvider: operations.repositoryMetadataProvider,
  });

  await search.search(page, sort);

  // await Promise.all(search.repos.map(repo => repo.getDetails()));

  req.individualContext.webContext.render({
    view: 'repos/',
    title: 'Repos',
    state: {
      organizations: isCrossOrg
        ? sortOrgs(operations.getOrganizations(operations.organizationNames))
        : undefined,
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
}
