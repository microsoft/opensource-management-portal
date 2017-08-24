//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

const Q = require('q');

const GitHubApi = require('github');
const githubPackage = require('github/package.json');

const restApi = require('./restApi');
const collections = require('./collections');
const core = require('./core');
const crossOrganization = require('./crossOrganization');
const links = require('./links');

// With the introduction of a breaking change in the underlying schema, any cache objects
// which are related to the GitHub library and have a SemVer equal to or less than this
// value will be discarded. The lack of a 'av' property (app version, originally) will
// also trigger a discard.
const breakingChangeGitHubPackageVersion = '4.2.0';

function createLibraryContext(options) {
  const redis = options.redis;
  if (!redis) {
    throw new Error('No Redis instance provided to the GitHub library context constructor.');
  }

  let config = options.config;
  if (!config) {
    throw new Error('No runtime configuration instance provided to the library context constructor.');
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
      debug: false,
      protocol: 'https',
      headers: {
        'user-agent': userAgent,
      },
      Promise: Q.Promise,
    });
    github.authenticate(); // turns off central auth
  }

  const libraryContext = {
    redis: redis,
    insights: options.insights,
    memoryCache: memoryCache,

    breakingChangeGitHubPackageVersion: breakingChangeGitHubPackageVersion,
  };

  libraryContext.hasNextPage = github.hasNextPage.bind(github);
  libraryContext.hasPreviousPage = github.hasPreviousPage.bind(github);
  libraryContext.hasLastPage = github.hasLastPage.bind(github);
  libraryContext.hasFirstPage = github.hasFirstPage.bind(github);

  libraryContext.getNextPage = restApi.wrapCreatePage(libraryContext, github, 'next');
  libraryContext.getPreviousPage = restApi.wrapCreatePage(libraryContext, github, 'prev');
  libraryContext.getLastPage = restApi.wrapCreatePage(libraryContext, github, 'last');
  libraryContext.getFirstPage = restApi.wrapCreatePage(libraryContext, github, 'first');

  libraryContext.call = function callGithub(token, api, options, cacheOptions, callback) {
    if (!callback && typeof(cacheOptions) === 'function') {
      callback = cacheOptions;
      cacheOptions = null;
    }
    cacheOptions = cacheOptions || {};

    let innerCallback = core.createCallbackFlattenData(callback, `CALL ${api}`);
    if (options.allowEmptyResponse) {
      delete options.allowEmptyResponse;
      innerCallback = callback;
    }

    const apiContext = restApi.create(api, options, github);
    apiContext.token = token;
    apiContext.libraryContext = libraryContext;

    if (cacheOptions.maxAgeSeconds) {
      apiContext.maxAgeSeconds = cacheOptions.maxAgeSeconds;
    }
    if (cacheOptions.backgroundRefresh !== undefined) {
      apiContext.backgroundRefresh = cacheOptions.backgroundRefresh;
    }
    return core.execute(apiContext, innerCallback);
  };

  // Post is a direct wrap around the GitHub library. It does not
  libraryContext.post = function callGitHubNoCache(token, api, options, callback) {
    const method = restApi.findGitHubMethod(github, api);
    if (!options.headers) {
      options.headers = {};
    }
    if (!options.headers.Authorization) {
      options.headers.Authorization = `token ${token}`;
    }
    method.call(github, options, core.createCallbackFlattenDataOptionally(callback));
  };

  libraryContext.collections = collections(libraryContext, libraryContext.call);

  if (!options.dataClient) {
    throw new Error('No dataClient/links functionality available to the library.');
  }
  libraryContext.links = links(libraryContext, options.dataClient);

  libraryContext.crossOrganization = crossOrganization(libraryContext, libraryContext.collections);

  return libraryContext;
}

module.exports = createLibraryContext;
