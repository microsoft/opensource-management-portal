//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

const GitHubApi = require('@octokit/rest');
const githubPackage = require('@octokit/rest/package.json');

// const restApi = require('./restApi');
const collections = require('./collections');
// const core = require('./core');
const crossOrganization = require('./crossOrganization');
const links = require('./links');
// import { IntelligentGitHubEngine, GitHubApiContext } from './restApi';
import * as restApi from './restApi';
import { createCallbackFlattenData, createCallbackFlattenDataOptionally } from './core';
import { CompositeIntelligentEngine } from './composite';
import { ILinkProvider } from '../linkProviders/postgres/postgresLinkProvider';

export interface ILibraryContext {
  redis?: any;
  insights?: any;
  linkProvider: ILinkProvider;
  memoryCache?: any;
  breakingChangeGitHubPackageVersion?: any;

  hasNextPage?: any;
  hasPreviousPage?: any;
  hasLastPage?: any;
  hasFirstPage?: any;

  getNextPage?: any;
  getNextPageExtended?: any;
  getPreviousPage?: any;
  getLastPage?: any;
  getFirstPage?: any;

  call?: any;
  request?: any;
  post?: any;

  collections?: any;
  links?: any;
  crossOrganization?: any;

  githubEngine?: restApi.IntelligentGitHubEngine;
  compositeEngine?: CompositeIntelligentEngine;
}

// With the introduction of a breaking change in the underlying schema, any cache objects
// which are related to the GitHub library and have a SemVer equal to or less than this
// value will be discarded. The lack of a 'av' property (app version, originally) will
// also trigger a discard.
const breakingChangeGitHubPackageVersion = '6.0.0';

function createLibraryContext(options): ILibraryContext {
  const redis = options.redis;
  if (!redis) {
    throw new Error('No Redis instance provided to the GitHub library context constructor.');
  }

  const linkProvider = options.linkProvider as ILinkProvider;
  if (!linkProvider) {
    throw new Error('No link provider included in the options to the library context constructor');
  }

  let config = options.config;
  if (!config) {
    throw new Error('No runtime configuration instance provided to the library context constructor');
  }

  let memoryCache = options.memoryCache || new Map();

  const nodeGithubVersion = `node-github/${githubPackage.version}`;
  let userAgent = nodeGithubVersion;
  if (config && config.github && config.github.library && config.github.library.userAgent) {
    userAgent = config.github.library.userAgent + ' ' + userAgent;
  }

  let github = options.github;
  if (!github) {
    let githubApi = options.GitHubApi || GitHubApi;
    github = new githubApi({
      headers: {
        'user-agent': userAgent,
      },
      // Promise: Q.Promise,
    });
    github.authenticate(); // turns off central auth
  }

  const libraryContext: ILibraryContext = {
    redis: redis,
    insights: options.insights,
    memoryCache: memoryCache,
    linkProvider,

    breakingChangeGitHubPackageVersion: breakingChangeGitHubPackageVersion,
  };

  libraryContext.githubEngine = new restApi.IntelligentGitHubEngine();
  libraryContext.compositeEngine = new CompositeIntelligentEngine();

  libraryContext.hasNextPage = github.hasNextPage.bind(github);
  libraryContext.hasPreviousPage = github.hasPreviousPage.bind(github);
  libraryContext.hasLastPage = github.hasLastPage.bind(github);
  libraryContext.hasFirstPage = github.hasFirstPage.bind(github);

  libraryContext.getNextPage = restApi.wrapCreatePage(libraryContext, github, 'next');
  libraryContext.getPreviousPage = restApi.wrapCreatePage(libraryContext, github, 'prev');
  libraryContext.getLastPage = restApi.wrapCreatePage(libraryContext, github, 'last');
  libraryContext.getFirstPage = restApi.wrapCreatePage(libraryContext, github, 'first');

  libraryContext.getNextPageExtended = restApi.wrapCreatePage(libraryContext, github, 'next', true);

  libraryContext.call = function callGithub(token, api, options, cacheOptions, callback) {
    if (!callback && typeof(cacheOptions) === 'function') {
      callback = cacheOptions;
      cacheOptions = null;
    }
    cacheOptions = cacheOptions || {};

    let innerCallback = createCallbackFlattenData(callback);
    if (options.allowEmptyResponse) {
      delete options.allowEmptyResponse;
      innerCallback = callback;
    }

    const apiContext = restApi.createFullContext(api, options, github, libraryContext);
    // const apiContext = restApi.create(api, options, github);
    apiContext.overrideToken(token);
    // apiContext.token = token;
    // apiContext.libraryContext = libraryContext;

    if (cacheOptions.maxAgeSeconds) {
      apiContext.maxAgeSeconds = cacheOptions.maxAgeSeconds;
    }
    if (cacheOptions.backgroundRefresh !== undefined) {
      apiContext.backgroundRefresh = cacheOptions.backgroundRefresh;
    }
    return libraryContext.githubEngine.execute(apiContext).then(result => {
      return innerCallback(null, result);
    }, innerCallback as (err: any) => any);
    // return core.execute(apiContext, (erx, erp) => {
    //   return innerCallback(erx, erp);
    // });
  };

  libraryContext.request = function callOctokitRequest(token, restEndpoint, parameters: any, cacheOptions, callback) {
    parameters = parameters || {};
    parameters['octokitRequest'] = restEndpoint;
    return libraryContext.call(token, 'request', parameters, cacheOptions, callback);
  };

  // Post is a direct wrap around the GitHub library. It does not
  libraryContext.post = function callGitHubNoCache(token, api, options, callback) {
    const method = restApi.IntelligentGitHubEngine.findLibaryMethod(github, api);
    if (!options.headers) {
      options.headers = {};
    }
    if (!options.headers.Authorization) {
      options.headers.Authorization = `token ${token}`;
    }
    try {
      const legacyCallback = createCallbackFlattenDataOptionally(callback);
      const promiseBack = method.call(github, options) as Promise<any>;
      promiseBack.then(value => {
        return legacyCallback(null, value);
      }).catch(error => {
        return legacyCallback(error, null);
      });
    } catch (missingOrMajorError) {
      return callback(missingOrMajorError);
    }
  };

  libraryContext.collections = collections(libraryContext, libraryContext.call);

  libraryContext.links = links(libraryContext, options.linkProvider);

  libraryContext.crossOrganization = crossOrganization(libraryContext, libraryContext.collections);

  return libraryContext;
}

module.exports = createLibraryContext;
