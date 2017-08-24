//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

const Q = require('q');
const moment = require('moment');
const querystring = require('querystring');

const defaultPageSize = 20; // GitHub.com seems to use a value around 33

function repoSearch(repos, options) {
  options = options || {};
  this.repos = repos; // is repoStore in opensource.microsoft.com, this is different by design
  this.pageSize = options.pageSize || defaultPageSize;

  this.observedLanguages = new Set();
  this.observedLanguagesEncoded = new Map();

  this.phrase = options.phrase;
  this.type = options.type;
  this.language = options.language;

  this.graphManager = options.graphManager;

  if (options.specificTeamRepos && options.specificTeamPermissions) {
    this.specificTeamRepos = options.specificTeamRepos;
    this.specificTeamPermissions = options.specificTeamPermissions;
  }

  if (options.teamsType && options.repoPermissions) {
    this.teamsType = options.teamsType;
    this.teamsSubType = options.teamsSubType;
    this.repoPermissions = options.repoPermissions;
    this.userRepos = options.userRepos;
  }
}

repoSearch.prototype.search = function search(tags, page, sort) {
  const self = this;
  self.page = parseInt(page);
  self.tags = tags;
  self.sort = sort ? sort.charAt(0).toUpperCase() + sort.slice(1) : 'Pushed';
  return Q.all(
    self.filterBySpecificTeam(self.specificTeamRepos)
        .filterByLanguageAndRecordAllLanguages(self.language)
        .filterByType(self.type)
        .filterByPhrase(self.phrase)
        .filterByTeams(self.teamsType)
        .determinePages()['sortBy' + self.sort]()
        .getPage(self.page)
        .augmentInformation()
        );
};

repoSearch.prototype.augmentInformation = function() {
  // Make sure we have the pretty dates and all for what's been selected
  this.repos.forEach(repo => {
    setupLocalDateInstances(repo);
    repo.momentDisplay = {};
    if (repo.moment.updated) {
      repo.momentDisplay.updated = repo.moment.updated.fromNow();
    }
    if (repo.moment.created) {
      repo.momentDisplay.created = repo.moment.created.fromNow();
    }
    if (repo.moment.pushed) {
      repo.momentDisplay.pushed = repo.moment.pushed.fromNow();
    }
  });
  return this;
};

repoSearch.prototype.determinePages = function() {
  this.totalPages = Math.ceil(this.repos.length / this.pageSize);
  this.totalRepos = this.repos.length;
  return this;
};

repoSearch.prototype.getPage = function(page) {
  this.repos = this.repos.slice((page - 1) * this.pageSize, ((page - 1) * this.pageSize) + this.pageSize);
  this.pageFirstRepo = 1 + ((page - 1) * this.pageSize);
  this.pageLastRepo = this.pageFirstRepo + this.repos.length - 1;
  return this;
};

repoSearch.prototype.sortByStars = function() {
  this.repos.sort((a, b) => { return b.stargazers_count - a.stargazers_count; });
  return this;
};

function repoMatchesPhrase(repo, phrase) {
  // Poor man's search, starting with just a raw includes search
  // Assumes that phrase is already lowercase to work
  let string = ((repo.name || '') + (repo.description || '') + (repo.id || '')).toLowerCase();
  return string.includes(phrase);
}

repoSearch.prototype.filterByType = function (type) {
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
};

repoSearch.prototype.filterByPhrase = function (phrase) {
  if (phrase) {
    phrase = phrase.toLowerCase();
    this.repos = this.repos.filter(r => { return repoMatchesPhrase(r, phrase); });
  }
  return this;
};

repoSearch.prototype.filterBySpecificTeam = function (specificTeamRepos) {
  if (specificTeamRepos) {
    // Also augment individual repos with permissions information
    const reposAndPermissions = new Map();
    specificTeamRepos.forEach(specificTeamAndPermission => {
      reposAndPermissions.set(specificTeamAndPermission.id, specificTeamAndPermission.permissions);
    });
    this.repos = this.repos.filter(repo => {
      const permissions = reposAndPermissions.get(repo.id);
      if (permissions) {
        repo.permissions = permissions;
      }
      return !!permissions;
    });
  }
  return this;
};

repoSearch.prototype.filterByTeams = function (teamsType) {
  if (teamsType === 'teamless' || teamsType === 'my') {
    const repoPermissions = this.repoPermissions;
    if (!repoPermissions) {
      throw new Error('Missing team and repo permissions instances to help filter by teams');
    }
    const repos = new Set();
    switch (teamsType) {

    case 'my': {
      const subType = this.teamsSubType;
      this.userRepos.forEach(repo => {
        const myPermission = repo.personalized.permission;
        let ok = false;
        if (subType === 'admin' && myPermission === 'admin') {
          ok = true;
        } else if (subType === 'write' && (myPermission === 'admin' || myPermission === 'write')) {
          ok = true;
        } else if (subType === 'read') {
          ok = true;
        }
        if (ok) {
          repos.add(repo.id);
        }
      });
      break;
    }

    case 'teamless': {
      repoPermissions.forEach(repo => {
        if (!repo.teams || repo.teams.length === 0) {
          repos.add(repo.id);
        }
      });
      break;
    }

    }
    this.repos = this.repos.filter(repo => {
      return repos.has(repo.id);
    });
  }
  return this;
};

repoSearch.prototype.filterByLanguageAndRecordAllLanguages = function (language) {
  const self = this;
  this.repos = this.repos.filter(r => {
    // Fill the set with all languages before filtering
    if (r.language) {
      self.observedLanguages.add(r.language);
      self.observedLanguagesEncoded.set(r.language, querystring.escape(r.language));
      self.observedLanguagesEncoded.set(r.language.toLowerCase(), querystring.escape(r.language));
    }
    if (!language) {
      return true;
    }
    if (r.language) {
      return r.language.toLowerCase() === language.toLowerCase();
    }
  });
  return this;
};

repoSearch.prototype.sortByForks = function() {
  this.repos.sort((a, b) => { return b.forks_count - a.forks_count; });
  return this;
};

repoSearch.prototype.sortBySize = function() {
  this.repos.sort((a, b) => {
    if (a.size > b.size) {
      return -1;
    } else if (a.size < b.size) {
      return 1;
    }
    return 0;
  });
  return this;
};

repoSearch.prototype.sortByAlphabet = function() {
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
};

function setupLocalDateInstances(repo) {
  if (repo.moment) {
    return;
  }
  const updated = repo.updated_at ? moment(repo.updated_at) : undefined;
  const pushed = repo.pushed_at ? moment(repo.pushed_at) : undefined;
  const created = repo.created_at ? moment(repo.created_at) : undefined;
  repo.moment = {
    updated: updated,
    pushed: pushed,
    created: created,
  };
}

function sortDates(a, b) { // Inverted sort (newest first)
  return b.isAfter(a) ? 1 : -1;
}

repoSearch.prototype.sortByUpdated = function() {
  this.repos = this.repos.filter(r => { return r.updated_at; });
  this.repos.sort((a, b) => {
    setupLocalDateInstances(a);
    setupLocalDateInstances(b);
    return sortDates(a.moment.updated, b.moment.updated);
  });
  return this;
};

repoSearch.prototype.sortByCreated = function() {
  this.repos = this.repos.filter(r => { return r.created_at; });
  this.repos.sort((a, b) => {
    setupLocalDateInstances(a);
    setupLocalDateInstances(b);
    return sortDates(a.moment.created, b.moment.created);
  });
  return this;
};

repoSearch.prototype.sortByPushed = function() {
  this.repos = this.repos.filter(r => { return r.pushed_at; });
  this.repos.sort((a, b) => {
    setupLocalDateInstances(a);
    setupLocalDateInstances(b);
    return sortDates(a.moment.pushed, b.moment.pushed);
  });
  return this;
};

repoSearch.prototype.filterPublic = function(publicOnly) {
  if (publicOnly) {
    this.repos = this.repos.filter(r => { return !r.private; });
  }
  return this;
};

module.exports = repoSearch;
