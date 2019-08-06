//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

/*eslint no-console: ["error', { allow: ["warn"] }] */

'use strict';

const _ = require('lodash');
import async = require('async');
const debug = require('debug')('oss-github');
import Q from 'q';

const cost = require('./cost');
import { createCallbackFlattenData } from './core';
import { ILibraryContext } from '.';
import { CompositeApiContext } from './composite';
import { Collaborator } from '../../business/collaborator';
import { Repository } from '../../business/repository';
import { Team } from '../../business/team';

const branchDetailsToCopy = [
  'name',
  'commit',
  'protected',
];
const repoDetailsToCopy = Repository.PrimaryProperties;
const teamDetailsToCopy = Team.PrimaryProperties;
const memberDetailsToCopy = Collaborator.PrimaryProperties;
const teamPermissionsToCopy = [
  'id',
  'name',
  'slug',
  'description',
  'members_count',
  'repos_count',
  'privacy',
  'permission',
];
const teamRepoPermissionsToCopy = [
  'id',
  'name',
  'full_name',
  'description',
  'private',
  'fork',
  'permissions',
];

function createIntelligentMethods(libraryContext: ILibraryContext, githubCall) {
  const getNextPageExtended = libraryContext.getNextPageExtended;
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
            headers: result.headers,
          });
        }
        try {
          // if (!result.link || !result.headers) {
            // result.link = '';
          // }
          done = pages >= pageLimit || !hasNextPage(result);
        } catch (nextPageError) {
          error = nextPageError;
          done = true;
        }
      }
      if (!done && !error && result.headers && result.headers['retry-after']) {
        const delaySeconds = result.headers['retry-after'];
        debug(`Retry-After header was present. Delaying before next page ${delaySeconds}s.`);
        return setTimeout(() => { next(); }, delaySeconds * 1000);
      }
      next(error);
    }
    async.whilst(
      () => { return !done; },
      (next) => {
        let method = recentResult ? getNextPageExtended : githubCall;
        let args = [];
        if (recentResult) {
          // Shares the original method name for use in cache optimizations
          args.push({ methodName });
        }
        args.push(token);
        let cb = processResult.bind(null, next);
        recentResult ? args.push(recentResult) : args.push(methodName, options);
        args.push(cb);
        method.apply(null, args);
      },
      (error) => {
        if (error) {
          console.warn(error);
        }
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
        if (requests[i] && requests[i].headers && requests[i].headers.etag) {
          pages.push(requests[i].headers.etag);
        } else {
          throw new Error('Invalid set of responses for pages');
        }
        if (requests[i] && requests[i].headers && requests[i].headers.statusActual && requests[i].headers.statusActual !== 304) {
          dirty = true;
          let lastModified = requests[i].headers['last-modified'];
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
      results.headers = {
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
    const apiContext = new CompositeApiContext(apiName, method, options);
    apiContext.maxAgeSeconds = cacheOptions.maxAgeSeconds || 600;
    apiContext.overrideToken(token);
    apiContext.libraryContext = libraryContext;
    if (cacheOptions.backgroundRefresh) {
      apiContext.backgroundRefresh = true;
    }
    const compositeEngine = libraryContext.compositeEngine;
    compositeEngine.execute(apiContext).then(ok => {
      return callback(null, ok);
    }, callback);
  }

  function getCollectionAndFilter(token, options, githubClientMethod, propertiesToKeep) {
    return function (token, options) {
      return getFilteredGithubCollectionWithMetadataAnalysis(token, githubClientMethod, options, propertiesToKeep);
    };
  }

  function generalizedCollectionWithFilter(name, githubClientMethod, propertiesToKeep, token, options, cacheOptions, callback) {
    return generalizedCollectionMethod(token, name, getCollectionAndFilter(token, options, githubClientMethod, propertiesToKeep), options, cacheOptions, createCallbackFlattenData(callback));
  }

  return {
    getOrgRepos: function getOrgRepos(token, options, cacheOptions, callback) {
      return generalizedCollectionWithFilter('orgRepos', 'repos.listForOrg', repoDetailsToCopy, token, options, cacheOptions, callback);
    },
    getOrgTeams: function getOrgTeams(token, options, cacheOptions, callback) {
      return generalizedCollectionWithFilter('orgTeams', 'teams.list', teamDetailsToCopy, token, options, cacheOptions, (xxx, eee) => {
        return callback(xxx, eee);
      });
    },
    getOrgMembers: function getOrgMembers(token, options, cacheOptions, callback) {
      return generalizedCollectionWithFilter('orgMembers', 'orgs.listMembers', memberDetailsToCopy, token, options, cacheOptions, callback);
    },
    getRepoTeams: function getRepoTeams(token, options, cacheOptions, callback) {
      return generalizedCollectionWithFilter('repoTeamPermissions', 'repos.listTeams', teamPermissionsToCopy, token, options, cacheOptions, callback);
    },
    getRepoCollaborators: function getRepoCollaborators(token, options, cacheOptions, callback) {
      return generalizedCollectionWithFilter('repoCollaborators', 'repos.listCollaborators', memberDetailsToCopy, token, options, cacheOptions, callback);
    },
    getRepoBranches: function getRepoBranches(token, options, cacheOptions, callback) {
      return generalizedCollectionWithFilter('repoBranches', 'repos.listBranches', branchDetailsToCopy, token, options, cacheOptions, callback);
    },
    getTeamMembers: function getTeamMembers(token, options, cacheOptions, callback) {
      return generalizedCollectionWithFilter('teamMembers', 'teams.listMembers', memberDetailsToCopy, token, options, cacheOptions, callback);
    },
    getTeamRepos: function getTeamRepos(token, options, cacheOptions, callback) {
      return generalizedCollectionWithFilter('teamRepos', 'teams.listRepos', teamRepoPermissionsToCopy, token, options, cacheOptions, callback);
    },
  };
}

module.exports = createIntelligentMethods;
