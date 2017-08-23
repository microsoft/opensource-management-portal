//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

const Q = require('q');

const defaultPageSize = 20; // GitHub.com seems to use a value around 33

function TeamSearch(teams, options) {
  options = options || {};
  this.teams = teams; //teamsWithMembers
  this.pageSize = options.pageSize || defaultPageSize;

  this.phrase = options.phrase;
  this.set = options.set;
  this.yourTeamsMap = options.yourTeamsMap || new Map();
}

TeamSearch.prototype.search = function search(tags, page, sort) {
  const self = this;
  self.page = parseInt(page);
  self.tags = tags;
  self.sort = sort ? sort.charAt(0).toUpperCase() + sort.slice(1) : 'Alphabet';
  return Q.all(
    self.filterByType(self.set)
        .filterByPhrase(self.phrase)
        .determinePages()['sortBy' + self.sort]()
        .getPage(self.page)
        );
};

TeamSearch.prototype.determinePages = function() {
  this.totalPages = Math.ceil(this.teams.length / this.pageSize);
  this.totalTeams = this.teams.length;
  return this;
};

TeamSearch.prototype.getPage = function(page) {
  this.teams = this.teams.slice((page - 1) * this.pageSize, ((page - 1) * this.pageSize) + this.pageSize);
  this.pageFirstTeam = 1 + ((page - 1) * this.pageSize);
  this.pageLastTeam = this.pageFirstTeam + this.teams.length - 1;
  return this;
};

function teamMatchesPhrase(team, phrase) {
  // Poor man's search, starting with just a raw includes search
  // Assumes that phrase is already lowercase to work
  let string = ((team.name || '') + (team.description || '') + (team.id || '') + (team.slug || '')).toLowerCase();
  return string.includes(phrase);
}

TeamSearch.prototype.filterByType = function (setType) {
  let filter = null;
  if (setType === 'your' || setType === 'available') {
    const showIfInSet = setType === 'your';
    filter = t => {
      const map = this.yourTeamsMap || new Map();
      return map.has(t.id) === showIfInSet;
    };
  }
  if (filter) {
    this.teams = this.teams.filter(filter);
  }
  return this;
};

TeamSearch.prototype.filterByPhrase = function (phrase) {
  if (phrase) {
    phrase = phrase.toLowerCase();
    this.teams = this.teams.filter(t => {
      return teamMatchesPhrase(t, phrase);
    });
  }
  return this;
};

TeamSearch.prototype.sortByAlphabet = function() {
  this.teams.sort((a, b) => {
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
};

module.exports = TeamSearch;
