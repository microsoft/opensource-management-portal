//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

/*eslint no-console: ["error", { allow: ["warn"] }] */

'use strict';

const _ = require('lodash');
const async = require('async');
const debug = require('debug')('oss-github');
const Q = require('q');

const composite = require('./composite');
const core = require('./core');
const cost = require('./cost');

const githubEntityClassification = require('../../data/github-entity-classification.json');

const branchDetailsToCopy = githubEntityClassification.branches.keep;
const repoDetailsToCopy = githubEntityClassification.repo.keep;
const teamDetailsToCopy = githubEntityClassification.team.keep;
const memberDetailsToCopy = githubEntityClassification.member.keep;
const teamPermissionsToCopy = githubEntityClassification.teamPermissions.keep;
const teamRepoPermissionsToCopy = githubEntityClassification.repoTeamPermissions.keep;

function createIntelligentMethods(libraryContext, githubCall) {
  const getNextPage = libraryContext.getNextPage;
  const hasNextPage = libraryContext.hasNextPage;

  function getGithubCollection(token, methodName, options, callback) {
    let done = false;
    let results = [];
    let recentResult = null;
    let requests = [];
    let pages = 0;
    const pageLimit = options.pageLimit || Number.MAX_VALUE;
    function processResult(next, error, result) {
      if (error) {
        done = true;
      } else {
        recentResult = result;
        if (result) {
          ++pages;
          if (Array.isArray(result)) {
            results = results.concat(result);
          } else if (result && result.data && Array.isArray(result.data)) {
            // TEMPORARY: This debug aid can be removed in Sept. 2017 after the changes are merged to prod
            // ---
            // While node-github v9.0.0+ sends the result back in the 'data' property,
            // our libraries strip this and promote the property to the root of the
            // response. As a result, any hits of this breakpoint here should be
            // reviewed and fixed.
            results = results.concat(result.data);
          }
          requests.push({
            cost: result.cost,
            meta: result.meta,
          });
        }
        done = pages >= pageLimit || !hasNextPage(result);
      }
      if (!done && !error && result.meta && result.meta['retry-after']) {
        const delaySeconds = result.meta['retry-after'];
        debug(`Retry-After header was present. Delaying before next page ${delaySeconds}s.`);
        return setTimeout(() => { next(); }, delaySeconds * 1000);
      }
      next(error);
    }
    async.whilst(
      () => { return !done; },
      (next) => {
        let method = recentResult ? getNextPage : githubCall;
        let args = [token];
        let cb = processResult.bind(null, next);
        recentResult ? args.push(recentResult) : args.push(methodName, options);
        args.push(cb);
        method.apply(null, args);
      },
      (error) => {
        const data = {
          data: results,
        };
        callback(error, error ? undefined : data, error ? undefined : requests);
      });
  }

  function getFilteredGithubCollection(token, methodName, options, propertiesToKeep, callback) {
    const keepAll = !propertiesToKeep;
    return getGithubCollection(token, methodName, options, (error, data, requests) => {
      if (!error && !data) {
        return callback(new Error('No error, no object, no data'));
      }
      if (!error && !data.data) {
        return callback(new Error('The resulting object did not contain a data property'));
      }
      if (error) {
        return callback(error);
      }
      const results = data.data;
      const repos = [];
      for (let i = 0; i < results.length; i++) {
        const doNotModify = results[i];
        if (doNotModify) {
          const r = {};
          _.forOwn(doNotModify, (value, key) => {
            if (keepAll || propertiesToKeep.indexOf(key) >= 0) {
              r[key] = value;
            }
          });
          repos.push(r);
        }
      }
      const filteredData = {
        data: repos,
      };
      callback(null, filteredData, requests);
    });
  }

  function getFilteredGithubCollectionWithMetadataAnalysis(token, methodName, options, propertiesToKeep) {
    const deferred = Q.defer();
    getFilteredGithubCollection(token, methodName, options, propertiesToKeep, (error, results, requests) => {
      if (error) {
        return deferred.reject(error);
      }
      const pages = [];
      let dirty = false;
      let dirtyModified = [];
      let compositeCost = cost.create();
      for (let i = 0; i < requests.length; i++) {
        if (requests[i] && requests[i].meta && requests[i].meta.etag) {
          pages.push(requests[i].meta.etag);
        } else {
          throw new Error('Invalid set of responses for pages');
        }
        if (requests[i] && requests[i].meta && requests[i].meta.statusActual && requests[i].meta.statusActual !== 304) {
          dirty = true;
          let lastModified = requests[i].meta['last-modified'];
          if (lastModified) {
            dirtyModified.push(lastModified);
          }
        }
        if (requests[i] && requests[i].cost) {
          cost.add(compositeCost, requests[i].cost);
        }
      }
      if (dirtyModified.length > 0) {
        debug('Last-Modified response was present. This work is not yet implemented.');
        // Some types, typically direct entities, will return this value; collections do not.
        // Would want to use the Last-Modified over the refresh time, sorting to find the latest.
      }
      results.meta = {
        pages: pages,
        dirty: dirty,
      };
      results.cost = compositeCost;
      deferred.resolve(results);
    });
    return deferred.promise;
  }

  function generalizedCollectionMethod(token, apiName, method, options, cacheOptions, callback) {
    if (callback === undefined && typeof (cacheOptions) === 'function') {
      callback = cacheOptions;
      cacheOptions = {};
    }
    const apiContext = composite.create(apiName, method, options);
    apiContext.maxAgeSeconds = cacheOptions.maxAgeSeconds || 600;
    apiContext.token = token;
    apiContext.libraryContext = libraryContext;
    if (cacheOptions.backgroundRefresh) {
      apiContext.backgroundRefresh = true;
    }
    return core.execute(apiContext, callback);
  }

  function getCollectionAndFilter(token, options, githubClientMethod, propertiesToKeep) {
    return function (token, options) {
      return getFilteredGithubCollectionWithMetadataAnalysis(token, githubClientMethod, options, propertiesToKeep);
    };
  }

  function generalizedCollectionWithFilter(name, githubClientMethod, propertiesToKeep, token, options, cacheOptions, callback) {
    return generalizedCollectionMethod(token, name, getCollectionAndFilter(token, options, githubClientMethod, propertiesToKeep), options, cacheOptions, core.createCallbackFlattenData(callback));
  }

  return {
    getOrgRepos: function getOrgRepos(token, options, cacheOptions, callback) {
      return generalizedCollectionWithFilter('orgRepos', 'repos.getForOrg', repoDetailsToCopy, token, options, cacheOptions, callback);
    },
    getOrgTeams: function getOrgTeams(token, options, cacheOptions, callback) {
      return generalizedCollectionWithFilter('orgTeams', 'orgs.getTeams', teamDetailsToCopy, token, options, cacheOptions, callback);
    },
    getOrgMembers: function getOrgMembers(token, options, cacheOptions, callback) {
      return generalizedCollectionWithFilter('orgMembers', 'orgs.getMembers', memberDetailsToCopy, token, options, cacheOptions, callback);
    },
    getRepoTeams: function getRepoTeams(token, options, cacheOptions, callback) {
      return generalizedCollectionWithFilter('repoTeamPermissions', 'repos.getTeams', teamPermissionsToCopy, token, options, cacheOptions, callback);
    },
    getRepoCollaborators: function getRepoCollaborators(token, options, cacheOptions, callback) {
      return generalizedCollectionWithFilter('repoCollaborators', 'repos.getCollaborators', memberDetailsToCopy, token, options, cacheOptions, callback);
    },
    getRepoBranches: function getRepoBranches(token, options, cacheOptions, callback) {
      return generalizedCollectionWithFilter('repoBranches', 'repos.getBranches', branchDetailsToCopy, token, options, cacheOptions, callback);
    },
    getTeamMembers: function getTeamMembers(token, options, cacheOptions, callback) {
      return generalizedCollectionWithFilter('teamMembers', 'orgs.getTeamMembers', memberDetailsToCopy, token, options, cacheOptions, callback);
    },
    getTeamRepos: function getTeamRepos(token, options, cacheOptions, callback) {
      return generalizedCollectionWithFilter('teamRepos', 'orgs.getTeamRepos', teamRepoPermissionsToCopy, token, options, cacheOptions, callback);
    },
  };
}

module.exports = createIntelligentMethods;
