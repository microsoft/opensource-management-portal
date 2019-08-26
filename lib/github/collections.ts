//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

/*eslint no-console: ["error', { allow: ["warn"] }] */

'use strict';

import _ from 'lodash';
import async from 'async';
import Q from 'q';

const debug = require('debug')('oss-github');

const cost = require('./cost');

import { createCallbackFlattenData } from './core';
import { ILibraryContext } from '.';
import { CompositeApiContext } from './composite';
import { Collaborator } from '../../business/collaborator';
import { Repository } from '../../business/repository';
import { Team } from '../../business/team';
import { IPagedCacheOptions } from '../../transitional';

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

export class RestCollections {
  private libraryContext: ILibraryContext;
  private githubCall: any;

  constructor(libraryContext: ILibraryContext, githubCall: any) {
    this.libraryContext = libraryContext;
    this.githubCall = githubCall;
  }
  getOrgRepos(token: string, options, cacheOptions: IPagedCacheOptions, callback) {
    return this.generalizedCollectionWithFilter('orgRepos', 'repos.listForOrg', repoDetailsToCopy, token, options, cacheOptions, callback);
  }

  getOrgTeams(token: string, options, cacheOptions: IPagedCacheOptions, callback) {
    return this.generalizedCollectionWithFilter('orgTeams', 'teams.list', teamDetailsToCopy, token, options, cacheOptions, (xxx, eee) => {
      return callback(xxx, eee);
    });
  }

  getOrgMembers(token: string, options, cacheOptions: IPagedCacheOptions, callback) {
    return this.generalizedCollectionWithFilter('orgMembers', 'orgs.listMembers', memberDetailsToCopy, token, options, cacheOptions, callback);
  }

  getRepoTeams(token: string, options, cacheOptions: IPagedCacheOptions, callback) {
    return this.generalizedCollectionWithFilter('repoTeamPermissions', 'repos.listTeams', teamPermissionsToCopy, token, options, cacheOptions, callback);
  }

  getRepoCollaborators(token: string, options, cacheOptions: IPagedCacheOptions, callback) {
    return this.generalizedCollectionWithFilter('repoCollaborators', 'repos.listCollaborators', memberDetailsToCopy, token, options, cacheOptions, callback);
  }

  getRepoBranches(token: string, options, cacheOptions: IPagedCacheOptions, callback) {
    return this.generalizedCollectionWithFilter('repoBranches', 'repos.listBranches', branchDetailsToCopy, token, options, cacheOptions, callback);
  }

  getTeamMembers(token: string, options, cacheOptions: IPagedCacheOptions, callback) {
    return this.generalizedCollectionWithFilter('teamMembers', 'teams.listMembers', memberDetailsToCopy, token, options, cacheOptions, callback);
  }

  getTeamRepos(token: string, options, cacheOptions: IPagedCacheOptions, callback) {
    return this.generalizedCollectionWithFilter('teamRepos', 'teams.listRepos', teamRepoPermissionsToCopy, token, options, cacheOptions, callback);
  }

  private getGithubCollection(token: string, methodName, options, cacheOptions: IPagedCacheOptions, callback) {
    const hasNextPage = this.libraryContext.hasNextPage;
    // const getNextPageExtended = this.libraryContext.getNextPageExtended;
    const githubCall = this.githubCall;

    let done = false;
    let results = [];
    let recentResult = null;
    let requests = [];
    let pages = 0;
    let currentPage = 0;
    const pageLimit = options.pageLimit || cacheOptions['pageLimit'] || Number.MAX_VALUE;
    const pageRequestDelay = cacheOptions.pageRequestDelay || null;
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
          done = pages >= pageLimit || !hasNextPage(result);
        } catch (nextPageError) {
          error = nextPageError;
          done = true;
        }
      }
      if (!done && !error && result.headers && result.headers['retry-after']) { // actual retry headers win
        const delaySeconds = result.headers['retry-after'];
        debug(`Retry-After header was present. Delaying before next page ${delaySeconds}s.`);
        return setTimeout(() => { next(); }, delaySeconds * 1000);
      } else if (pageRequestDelay) {
        const to = typeof(pageRequestDelay);
        let evaluatedTime = 0;
        if (to === 'number') {
          evaluatedTime = pageRequestDelay as number;
        } else if (to === 'function') {
          evaluatedTime = (pageRequestDelay as unknown as any)();
        } else {
          return next(new Error(`Unsupported pageRequestDelay type: ${to}`));
        }
        return setTimeout(() => { next(error); }, evaluatedTime);
      } else {
        return next(error);
      }
    }
    async.whilst(
      () => { return !done; },
      (next) => {
        // let method = recentResult ? getNextPageExtended : githubCall;
        let method = githubCall;
        let args = [];
        if (false && recentResult) {
          // Shares the original method name for use in cache optimizations
          args.push({ methodName });
        }
        args.push(token);
        let cb = processResult.bind(null, next);
        const clonedOptions = Object.assign({}, options);
        if (++currentPage > 1) {
          clonedOptions.page = currentPage;
        }
        args.push(methodName, clonedOptions);
        // recentResult ? args.push(recentResult) : args.push(methodName, options);
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

  private getFilteredGithubCollection(token: string, methodName, options, cacheOptions: IPagedCacheOptions, propertiesToKeep, callback) {
    const keepAll = !propertiesToKeep;
    return this.getGithubCollection(token, methodName, options, cacheOptions, (error, data, requests) => {
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

  private getFilteredGithubCollectionWithMetadataAnalysis(token: string, methodName, options, cacheOptions: IPagedCacheOptions, propertiesToKeep) {
    const deferred = Q.defer();
    this.getFilteredGithubCollection(token, methodName, options, cacheOptions, propertiesToKeep, (error, results, requests) => {
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

  private generalizedCollectionMethod(token: string, apiName: string, method, options, cacheOptions: IPagedCacheOptions, callback) {
    const apiContext = new CompositeApiContext(apiName, method, options);
    apiContext.maxAgeSeconds = cacheOptions.maxAgeSeconds || 600;
    apiContext.overrideToken(token);
    apiContext.libraryContext = this.libraryContext;
    if (cacheOptions.backgroundRefresh) {
      apiContext.backgroundRefresh = true;
    }
    const compositeEngine = this.libraryContext.compositeEngine;
    compositeEngine.execute(apiContext).then(ok => {
      return callback(null, ok);
    }, callback);
  }

  private getCollectionAndFilter(token: string, options, cacheOptions: IPagedCacheOptions, githubClientMethod, propertiesToKeep) {
    const capturedThis = this;
    return function (token, options) {
      return capturedThis.getFilteredGithubCollectionWithMetadataAnalysis(token, githubClientMethod, options, cacheOptions, propertiesToKeep);
    };
  }

  private generalizedCollectionWithFilter(name, githubClientMethod, propertiesToKeep, token, options, cacheOptions: IPagedCacheOptions, callback) {
    return this.generalizedCollectionMethod(token, name, this.getCollectionAndFilter(token, options, cacheOptions, githubClientMethod, propertiesToKeep), options, cacheOptions, createCallbackFlattenData(callback));
  }
}
