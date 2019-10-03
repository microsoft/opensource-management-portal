//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

import moment from 'moment';
import querystring from 'querystring';

import { Repository } from './repository';
import { IPersonalizedUserAggregateRepositoryPermission, GraphManager } from './graphManager';
import { IRequestTeamPermissions } from '../middleware/github/teamPermissions';
import { GitHubRepositoryPermission } from '../entities/repositoryMetadata/repositoryMetadata';
import { asNumber } from '../utils';

const defaultPageSize = 20; // GitHub.com seems to use a value around 33

export interface IRepositorySearchOptions {
  pageSize?: number;
  phrase?: string;
  type?: string;
  language?: string;
  userRepos?: IPersonalizedUserAggregateRepositoryPermission[];
  teamsType?: string; // ?
  teamsSubType?: string; // ?
  specificTeamRepos?: Repository[];
  specificTeamPermissions?: IRequestTeamPermissions;
  graphManager?: GraphManager;
}

export class RepositorySearch {
  repos: Repository[];

  pageSize: number;
  observedLanguages: Set<string>;
  observedLanguagesEncoded: Map<string, string>;
  phrase: string;
  type: string;
  language: string;

  teamsType: string;
  teamsSubType: string;
  // repoPermissions: any;
  userRepos: IPersonalizedUserAggregateRepositoryPermission[];

  page: number;
  tags: any;
  sort: any;

  totalPages: number;
  totalRepos: number;
  pageFirstRepo: number;
  pageLastRepo: number;

  private specificTeamRepos: Repository[];

  constructor(repos: Repository[], options: IRepositorySearchOptions) {
    options = options || {};
    this.repos = repos; // is repoStore in opensource.microsoft.com, this is different by design
    this.pageSize = options.pageSize || defaultPageSize;

    this.observedLanguages = new Set();
    this.observedLanguagesEncoded = new Map();

    this.phrase = options.phrase;
    this.type = options.type;
    this.language = options.language;

    if (options.specificTeamRepos) {
      this.specificTeamRepos = options.specificTeamRepos;
    }

    if (options.teamsType && options.userRepos) { // options.repoPermissions) {
      this.teamsType = options.teamsType;
      this.teamsSubType = options.teamsSubType;
      // this.repoPermissions = options.repoPermissions;
      this.userRepos = options.userRepos;
    }
  }

  search(page: number, sort: string): Promise<RepositorySearch> {
    this.page = page;
    this.sort = sort ? sort.charAt(0).toUpperCase() + sort.slice(1) : 'Pushed';
    return this.filterBySpecificTeam(this.specificTeamRepos)
      .filterByLanguageAndRecordAllLanguages(this.language)
      .filterByType(this.type)
      .filterByPhrase(this.phrase)
      .filterByTeams(this.teamsType)
      .determinePages()['sortBy' + this.sort]()
      .getPage(this.page);
  }

  determinePages(): RepositorySearch {
    this.totalPages = Math.ceil(this.repos.length / this.pageSize);
    this.totalRepos = this.repos.length;
    return this;
  }

  getPage(page): RepositorySearch {
    this.repos = this.repos.slice((page - 1) * this.pageSize, ((page - 1) * this.pageSize) + this.pageSize);
    this.pageFirstRepo = 1 + ((page - 1) * this.pageSize);
    this.pageLastRepo = this.pageFirstRepo + this.repos.length - 1;
    return this;
  }

  sortByStars(): RepositorySearch {
    this.repos.sort((a, b) => { return b.stargazers_count - a.stargazers_count; });
    return this;
  }

  filterByType(type: string): RepositorySearch {
    let filter = null;
    switch (type) {
    case 'public':
      filter = r => { return r.private === false; };
      break;
    case 'private':
      filter = r => { return r.private === true; };
      break;
    case 'source':
      filter = r => { return r.fork === false; };
      break;
    case 'fork':
      filter = r => { return r.fork === true; };
      break;
    }
    if (filter) {
      this.repos = this.repos.filter(filter);
    }
    return this;
  }

  filterByPhrase(phrase: string): RepositorySearch {
    if (phrase) {
      phrase = phrase.toLowerCase();
      this.repos = this.repos.filter(r => { return this.repoMatchesPhrase(r, phrase); });
    }
    return this;
  }

  filterBySpecificTeam(specificTeamRepos): RepositorySearch {
    if (specificTeamRepos) {
      // Also augment individual repos with permissions information
      const reposAndPermissions = new Map();
      specificTeamRepos.forEach(specificTeamAndPermission => {
        reposAndPermissions.set(specificTeamAndPermission.id, specificTeamAndPermission.permissions);
      });
      this.repos = this.repos.filter(repo => {
        const permissions = reposAndPermissions.get(repo.id);
        if (permissions) {
          // TODO: a more official flywheel attach vs adding an uninterfaced property
          repo['permissions'] = permissions;
        }
        return !!permissions;
      });
    }
    return this;
  }

  filterByTeams(teamsType: string): RepositorySearch {
    if (teamsType === 'my') {
      const userRepos = this.userRepos;
      if (!userRepos) {
        throw new Error('Missing team and repo permissions to filter by teams');
      }
      const repos = new Set<number>();
      switch (teamsType) {
        case 'my': {
          const subType = this.teamsSubType;
          userRepos.forEach(personalized => {
            const myPermission = personalized.bestComputedPermission;
            let ok = false;
            if (subType === 'admin' && myPermission === GitHubRepositoryPermission.Admin) {
              ok = true;
            } else if (subType === 'write' && (myPermission === 'admin' || myPermission === GitHubRepositoryPermission.Push)) {
              ok = true;
            } else if (subType === 'read') {
              ok = true;
            }
            if (ok) {
              repos.add(asNumber(personalized.repository.id));
            }
          });
          break;
        }
      }
      this.repos = this.repos.filter(repo => {
        return repos.has(asNumber(repo.id));
      });
    }
    return this;
  }

  filterByLanguageAndRecordAllLanguages(language: string): RepositorySearch {
    this.repos = this.repos.filter(r => {
      // Fill the set with all languages before filtering
      if (r.language) {
        this.observedLanguages.add(r.language);
        this.observedLanguagesEncoded.set(r.language, querystring.escape(r.language));
        this.observedLanguagesEncoded.set(r.language.toLowerCase(), querystring.escape(r.language));
      }
      if (!language) {
        return true;
      }
      if (r.language) {
        return r.language.toLowerCase() === language.toLowerCase();
      }
    });
    return this;
  }

  sortByForks() {
    this.repos.sort((a, b) => { return b.forks_count - a.forks_count; });
    return this;
  }

  sortBySize(): RepositorySearch {
    this.repos.sort((a, b) => {
      if (a.size > b.size) {
        return -1;
      } else if (a.size < b.size) {
        return 1;
      }
      return 0;
    });
    return this;
  }

  sortByAlphabet(): RepositorySearch {
    this.repos.sort((a, b) => {
      let nameA = a.name.toLowerCase();
      let nameB = b.name.toLowerCase();
      if (nameA < nameB) {
        return -1;
      }
      if (nameA > nameB) {
        return 1;
      }
      return 0;
    });
    return this;
  }

  private repoMatchesPhrase(repo: Repository, phrase: string): boolean {
    // Poor man's search, starting with just a raw includes search
    // Assumes that phrase is already lowercase to work
    let string = ((repo.name || '') + (repo.description || '') + (repo.id || '')).toLowerCase();
    return string.includes(phrase);
  }

  private sortDates(a: moment.Moment, b: moment.Moment): number { // Inverted sort (newest first)
    return b.isAfter(a) ? 1 : -1;
  }

  sortByUpdated(): RepositorySearch {
    this.repos = this.repos.filter(r => { return r.updated_at; });
    this.repos.sort((a, b) => {
      return this.sortDates(a.moment.updated, b.moment.updated);
    });
    return this;
  }

  sortByCreated(): RepositorySearch {
    this.repos = this.repos.filter(r => { return r.created_at; });
    this.repos.sort((a, b) => {
      return this.sortDates(a.moment.created, b.moment.created);
    });
    return this;
  }

  sortByPushed(): RepositorySearch {
    this.repos = this.repos.filter(r => { return r.pushed_at; });
    this.repos.sort((a, b) => {
      return this.sortDates(a.moment.pushed, b.moment.pushed);
    });
    return this;
  }

  filterPublic(publicOnly: boolean): RepositorySearch {
    if (publicOnly) {
      this.repos = this.repos.filter(r => { return !r.private; });
    }
    return this;
  }
}
