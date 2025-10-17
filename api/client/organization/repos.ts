//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { NextFunction, Response, Router } from 'express';

import { jsonError } from '../../../middleware/index.js';
import { CreateError, getProviders } from '../../../lib/transitional.js';
import { Repository } from '../../../business/index.js';

import JsonPager from '../jsonPager.js';
import { ReposAppRequest, IProviders } from '../../../interfaces/index.js';
import { sortRepositoriesByNameCaseInsensitive } from '../../../lib/utils.js';
import { apiMiddlewareRepositoriesToRepository } from '../../../middleware/business/repository.js';

import routeRepo from './repo.js';
import getCompanySpecificDeployment from '../../../middleware/companySpecificDeployment.js';

const router: Router = Router();

router.get('/', async (req: ReposAppRequest, res: Response, next: NextFunction) => {
  const { organization } = req;
  const providers = getProviders(req);
  const pager = new JsonPager<Repository>(req, res);
  let searchOptions: ISearchReposOptions = {
    q: (req.query.q || '') as string,
    type: (req.query.type || '') as string, // CONSIDER: TS: stronger typing
  };
  try {
    const companySpecificDeployment = getCompanySpecificDeployment();
    if (companySpecificDeployment?.features?.repositorySearch?.augmentSearchOptions) {
      searchOptions = await companySpecificDeployment.features.repositorySearch.augmentSearchOptions(
        providers,
        req,
        searchOptions
      );
    }
    const repos = await searchRepos(
      providers,
      String(organization.id),
      RepositorySearchSortOrder.Updated,
      searchOptions
    );
    const slice = pager.slice(repos);
    return pager.sendJson(
      slice.map((repo) => {
        return repo.asJson();
      })
    );
  } catch (repoError) {
    console.dir(repoError);
    return next(jsonError(repoError));
  }
});

// --- Search reimplementation ---

export enum RepoListSearchType {
  All = '',
  Public = 'public',
  Private = 'private',
  Sources = 'sources',
  Forks = 'forks',
}

export function repoListSearchTypeToDisplayName(v: RepoListSearchType) {
  switch (v) {
    case RepoListSearchType.All:
      return 'All';
    case RepoListSearchType.Forks:
      return 'Forks';
    case RepoListSearchType.Private:
      return 'Private';
    case RepoListSearchType.Public:
      return 'Public';
    case RepoListSearchType.Sources:
      return 'Sources';
    default:
      throw new Error('Not a supported type');
  }
}

export function repoSearchTypeFilterFromStringToEnum(value: string) {
  value = value || '';
  switch (value) {
    case RepoListSearchType.All:
    case RepoListSearchType.Public:
    case RepoListSearchType.Private:
    case RepoListSearchType.Forks:
    case RepoListSearchType.Sources:
      return value as RepoListSearchType;
    default:
      return RepoListSearchType.All;
  }
}

export enum RepositorySearchSortOrder {
  Recent = 'recent',
  Stars = 'stars',
  Forks = 'forks',
  Name = 'name',
  Updated = 'updated',
  Created = 'created',
  Size = 'size',
}

type RepoFilterFunction = (a: Repository) => boolean;

function getFilter(type: RepoListSearchType): RepoFilterFunction {
  switch (type) {
    case RepoListSearchType.Forks:
      return (repo) => {
        return repo.fork;
      };
    case RepoListSearchType.Sources:
      return (repo) => {
        return !repo.fork;
      }; // ? is this what 'Sources' means on GitHub?
    case RepoListSearchType.Public:
      return (repo) => {
        return !repo.private;
      };
    case RepoListSearchType.Private:
      return (repo) => {
        return repo.private;
      };
    case RepoListSearchType.All:
    default:
      return (repo) => {
        return true;
      };
  }
}

type RepoSortFunction = (a: Repository, b: Repository) => number;

function sortDates(fieldName: string, a: Repository, b: Repository): number {
  // Inverted sort (newest first)
  const aa = a[fieldName]
    ? typeof a[fieldName] === 'string'
      ? new Date(a[fieldName])
      : a[fieldName]
    : new Date(0);
  const bb = b[fieldName]
    ? typeof b[fieldName] === 'string'
      ? new Date(b[fieldName])
      : b[fieldName]
    : new Date(0);
  return aa == bb ? 0 : aa < bb ? 1 : -1;
}

function getSorter(search: RepositorySearchSortOrder): RepoSortFunction {
  switch (search) {
    case RepositorySearchSortOrder.Recent: {
      return sortDates.bind(null, 'pushed_at');
    }
    case RepositorySearchSortOrder.Created: {
      return sortDates.bind(null, 'created_at');
    }
    case RepositorySearchSortOrder.Updated: {
      return sortDates.bind(null, 'updated_at');
    }
    case RepositorySearchSortOrder.Forks: {
      return (a, b) => {
        return b.forks_count - a.forks_count;
      };
    }
    case RepositorySearchSortOrder.Name: {
      return sortRepositoriesByNameCaseInsensitive;
    }
    case RepositorySearchSortOrder.Size: {
      return (a, b) => {
        if (a.size > b.size) {
          return -1;
        } else if (a.size < b.size) {
          return 1;
        }
        return 0;
      };
    }
    case RepositorySearchSortOrder.Stars: {
      return (a, b) => {
        return b.stargazers_count - a.stargazers_count;
      };
    }
    default: {
      break;
    }
  }
  throw new Error('Not a supported search type');
}

function repoMatchesPhrase(phrase: string, repo: Repository) {
  // function assumes string is already lowercase
  // allow searching using GitHub repo URLs
  if (phrase?.startsWith('https://github.com/')) {
    const parts = phrase.split('/');
    if (parts.length >= 5) {
      phrase = parts[3] + '/' + parts[4] + '/';
    }
  }
  const fullName = repo.full_name || repo.organization.name + '/' + repo.name + '/';
  const string = ((repo.name || '') + (repo.description || '') + fullName + (repo.id || '')).toLowerCase();
  return string.includes(phrase);
}

export interface ISearchReposOptions {
  q?: string;
  type?: string;
  language?: string;
}

export async function searchRepos(
  providers: IProviders,
  organizationId: string,
  sort: RepositorySearchSortOrder,
  options: ISearchReposOptions
) {
  const { queryCache } = providers;
  const { q, type } = options;
  const companySpecific = getCompanySpecificDeployment();
  if (companySpecific?.features?.repositorySearch?.primeSearchData) {
    await companySpecific.features.repositorySearch.primeSearchData(providers, options);
  }
  // TODO: aggressive in-memory caching for each org
  let repositories = (
    organizationId
      ? await queryCache.organizationRepositories(organizationId.toString())
      : await queryCache.allRepositories()
  ).map((wrapper) => wrapper.repository);

  // Filters
  if (q) {
    const phrase = q.toLowerCase();
    repositories = repositories.filter(repoMatchesPhrase.bind(null, phrase));
  }

  // TODO: const language = null;

  if (type) {
    const t = repoSearchTypeFilterFromStringToEnum(type);
    if (t !== RepoListSearchType.All) {
      repositories = repositories.filter(getFilter(t));
    }
  }

  if (companySpecific?.features?.repositorySearch?.searchRepos) {
    repositories = await companySpecific.features.repositorySearch.searchRepos(
      providers,
      options,
      repositories
    );
  }

  // Sort
  repositories.sort(getSorter(sort));

  return repositories;
}

// --- End of search reimplementation ---

router.use('/:repoName', apiMiddlewareRepositoriesToRepository, routeRepo);

router.use('/*splat', (req, res: Response, next: NextFunction) => {
  return next(CreateError.NotFound('no API or function available within org/repos endpoint'));
});

export default router;
