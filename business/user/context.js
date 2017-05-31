//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

const _ = require('lodash');
const Q = require('q');

const LinkManager = require('./linkManager');

class UserContext {
  constructor(operations, id) {
    this.id = typeof(id) === 'string' ? parseInt(id, 10) : id;

    const privates = _private(this);
    privates.operations = operations;
  }

  get linkManager() {
    const privates = _private(this);
    if (!privates.linkManager) {
      privates.linkManager = new LinkManager(privates.operations, this);
    }
    return privates.linkManager;
  }

  // ------------------------------ Views -------------------------------------
  // These "views" may eventually need to be a little crisper/cleaner
  // --------------------------------------------------------------------------

  getAggregatedOrganizationOverview(orgName, callback) {
    this.getAggregatedOverview((error, results) => {
      if (error) {
        return callback(error);
      }
      const lco = orgName.toLowerCase();
      const removeOtherTeams = team => {
        return team.organization.login.toLowerCase() !== lco;
      };
      _.remove(results.teams.member, removeOtherTeams);
      _.remove(results.teams.maintainer, removeOtherTeams);
      // At this time it does not simplify or reduce repo lists or the general orgs list
      return callback(null, results);
    });
  }

  getAggregatedOverview(callback) {
    Q.allSettled([
      this.getOrganizationNames(),
      this.getOrganizationStatuses(),
      this.getOrganizationStatuses('admin'),
      this.getTeamMemberships(),
      this.getTeamMemberships('maintainer'),
      Q(null), //this.getRepoCollaborators(),
      this.getRepoTeams(),
    ]).spread((orgNames, orgStatuses, orgOwners, myTeams, myTeamMaintainers, repos, repoTeams) => {
      const errors = promisesToErrors(orgNames, orgStatuses, orgOwners, myTeams, myTeamMaintainers, repos, repoTeams);
      orgNames = promiseResultToObject(orgNames);
      const results = {
        organizations: {
          member: promiseResultToObject(orgStatuses),
          owned: promiseResultToObject(orgOwners),
        },
        teams: {
          member: promiseResultToObject(myTeams),
          maintainer: promiseResultToObject(myTeamMaintainers),
        },
        repos: {
          byTeam: promiseResultToObject(repoTeams),
          byCollaboration: promiseResultToObject(repos),
        },
      };

      // Available organizations
      if (results.organizations.member) {
        results.organizations.available = _.difference(orgNames, results.organizations.member);
      }

      // Sort organization lists
      insensitiveCaseArrayReplacement(results.organizations, 'available');
      insensitiveCaseArrayReplacement(results.organizations, 'member');
      insensitiveCaseArrayReplacement(results.organizations, 'owned');

      if (errors) {
        results.errors = errors;
      }
      return results;
    }, callback)
    .then(results => {
      return callback(null, results);
    }, callback);
  }

  getRepoCollaborators() {
    const deferred = Q.defer();
    const operations = _private(this).operations;
    const options = {};
    operations.graphManager.getReposWithCollaborators(options, (error, repos) => {
      if (error) {
        return deferred.reject(error);
      }
      return deferred.resolve(repos);
    });
    return deferred.promise;
  }

  getRepoTeams() {
    const deferred = Q.defer();
    const operations = _private(this).operations;
    const options = {};
    operations.graphManager.getUserReposByTeamMemberships(this.id, options, (error, repos) => {
      if (error) {
        return deferred.reject(error);
      }
      return deferred.resolve(repos);
    });
    return deferred.promise;
  }

  getTeamMemberships(optionalRole) {
    const deferred = Q.defer();
    const operations = _private(this).operations;
    const options = {};
    if (optionalRole) {
      options.role = optionalRole;
    }
    options.maxAgeSeconds = 60 * 10;
    options.backgroundRefresh = true;
    operations.graphManager.getUserTeams(this.id, options, (error, teams) => {
      if (error) {
        return deferred.reject(error);
      }
      return deferred.resolve(teams);
    });
    return deferred.promise;
  }

  getOrganizationNames() {
    return Q(_private(this).operations.getOrganizationOriginalNames());
  }

  getOrganizationStatuses(optionalRole) {
    const operations = _private(this).operations;
    const deferred = Q.defer();
    const options = {};
    if (optionalRole) {
      options.role = optionalRole;
    }
    operations.graphManager.getMember(this.id, options, (error, member) => {
      if (error) {
        return deferred.reject(error);
      }
      const value = member && member.orgs ? member.orgs : [];
      return deferred.resolve(value);
    });
    return deferred.promise;
  }

  // ------------------------------ End views ---------------------------------

}

module.exports = UserContext;

function insensitiveCaseArrayReplacement(parent, key) {
  if (parent && parent[key]) {
    const input = parent[key];
    delete parent[key];
    parent[key] = _.orderBy(input, entry => entry.toLowerCase());
  }
}

function promisesToErrors() {
  const errors = [];
  for (const promise of arguments) {
    if (promise && promise.state !== 'fulfilled') {
      errors.push(promise.reason.message || promise.reason);
    }
  }
  return errors.length > 0 ? errors : undefined;
}

function promiseResultToObject(promiseResult) {
  if (promiseResult && promiseResult.state && promiseResult.state === 'fulfilled') {
    return promiseResult.value;
  }
}

const privateSymbol = Symbol();
function _private(self) {
  if (self[privateSymbol] === undefined) {
    self[privateSymbol] = {};
  }
  return self[privateSymbol];
}
