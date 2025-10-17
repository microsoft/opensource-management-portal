//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { CreateError } from '../lib/transitional.js';

const defaultPageSize = 20; // GitHub.com seems to use a value around 33

export default class TeamSearch {
  private teams: any;
  private page: any;
  private pageSize: any;
  private set: any;
  private yourTeamsMap: any;
  private phrase: string;
  private sort: string;

  public pageLastTeam: number;
  public pageFirstTeam: number;
  public totalPages: number;
  public totalTeams: number;

  constructor(teams, options) {
    options = options || {};
    this.teams = teams; //teamsWithMembers
    this.pageSize = options.pageSize || defaultPageSize;

    this.phrase = options.phrase;
    this.set = options.set;
    this.yourTeamsMap = options.yourTeamsMap || new Map();
  }

  search(page: number, sort?: string): Promise<void> {
    this.page = page;
    this.sort = sort ? sort.charAt(0).toUpperCase() + sort.slice(1) : 'Alphabet';
    const sortMethodName = 'sortBy' + this.sort;
    const sortMethod = this[sortMethodName];
    if (!sortMethod) {
      throw CreateError.InvalidParameters(`Invalid sort method: ${sortMethodName}`);
    }
    // prettier-ignore
    return this.filterByType(this.set)
      .filterByPhrase(this.phrase)
      .determinePages()[sortMethodName]() // prettier will mangle this; CodeQL: given the explicit check and sortBy prefix on `this`, we are OK with this dynamic call by name.
      .getPage(this.page);
  }

  determinePages() {
    this.totalPages = Math.ceil(this.teams.length / this.pageSize);
    this.totalTeams = this.teams.length;
    return this;
  }

  getPage(page: number) {
    this.teams = this.teams.slice((page - 1) * this.pageSize, (page - 1) * this.pageSize + this.pageSize);
    this.pageFirstTeam = 1 + (page - 1) * this.pageSize;
    this.pageLastTeam = this.pageFirstTeam + this.teams.length - 1;
    return this;
  }

  filterByType(setType) {
    let filter = null;
    if (setType === 'your' || setType === 'available') {
      const showIfInSet = setType === 'your';
      filter = (t) => {
        const map = this.yourTeamsMap || new Map();
        return map.has(t.id) === showIfInSet;
      };
    }
    if (filter) {
      this.teams = this.teams.filter(filter);
    }
    return this;
  }

  filterByPhrase(phrase: string) {
    if (phrase) {
      phrase = phrase.toLowerCase();
      this.teams = this.teams.filter((t) => {
        return teamMatchesPhrase(t, phrase);
      });
    }
    return this;
  }

  sortByAlphabet() {
    this.teams.sort((a, b) => {
      const nameA = a.name.toLowerCase();
      const nameB = b.name.toLowerCase();
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
}

function teamMatchesPhrase(team, phrase) {
  // Poor man's search, starting with just a raw includes search
  // Assumes that phrase is already lowercase to work
  const string = (
    (team.name || '') +
    (team.description || '') +
    (team.id || '') +
    (team.slug || '')
  ).toLowerCase();
  return string.includes(phrase);
}
