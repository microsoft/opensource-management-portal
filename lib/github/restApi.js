//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

/*eslint no-console: ["error", { allow: ["log"] }] */

'use strict';

const _ = require('lodash');
const debug = require('debug')('oss-github');
const moment = require('moment');
const Q = require('q');
const querystring = require('querystring');
const semver = require('semver');
const url = require('url');

const core = require('./core');

const appPackage = require('../../package');
const appVersion = appPackage.version;

const longtermMetadataMinutes = 60 * 24 * 14; // assumed to be a long time
const longtermResponseMinutes = 60 * 24 * 7; // a week, sliding
const acceleratedExpirationMinutes = 10; // quick cleanup

function createFullContext(api, options, github) {
  return prepareApiContextForGithub(createApiContextForGithub(api, options), github);
}

function createApiContextForGithub(api, options) {
  const apiContext = core.createContext(api, options);
  return apiContext;
}

function createApiContextFromLink(github, linkAddress) {
  const api = 'getPage';
  const link = url.parse(linkAddress);
  const qs = querystring.parse(link.query);
  const pathArray = _.compact(link.pathname.split('/'));

  // Translate the path into key/value pairs
  const options = {};
  if (/* odd # */ pathArray.length % 2 !== 0) {
    options.t = pathArray.pop();
  }
  while (pathArray.length > 0) {
    const value = pathArray.pop();
    const key = pathArray.pop();
    options[key] = value;
  }

  // If an access_token is provided to the query string, then it is present in
  // the link. The trouble is this would lead to the need to encrypt Redis,
  // which is not great. Let's block this here and just use headers for auth.
  if (qs.access_token) {
    throw new Error('For security purposes this library was unable to process the provided link.');
  }

  // Merge query string pairs
  Object.assign(options, qs);
  const apiContext = createApiContextForGithub(api, options);
  // Use a fake link to call into the GitHub library via the "next page"
  const fakeLink = {
    link: `<${linkAddress}>; rel="next"`,
  };
  apiContext.fakeLink = fakeLink;
  github.getNextPage.thisInstance = github; // hack!
  apiContext.apiMethod = github.getNextPage;
  return apiContext;
}

function findGitHubMethod(instance, combined) {
  const i = combined.indexOf('.');
  let apiGroup = null;
  let apiMethodName = combined;
  if (i >= 0) {
    apiGroup = combined.substr(0, i);
    apiMethodName = combined.substr(i + 1);
  }
  const group = apiGroup ? instance[apiGroup] : instance;
  if (!group) {
    throw new Error(`The GitHub REST API library does not support the API group of type "${apiGroup}".`);
  }
  const method = group[apiMethodName];
  if (!method) {
    throw new Error(`The GitHub REST API library does not support the API "${apiMethodName}" within the API group of type "${apiGroup}".`);
  }
  return method;
}

function updateMetadataWithResponse(apiContext, response) {
  return Q(response);
}

function prepareApiContextForGithub(apiContext, github) {
  if (!apiContext.apiMethod) {
    const method = findGitHubMethod(github, apiContext.api);
    method.thisInstance = github;
    apiContext.apiMethod = method;
  }
  if (!apiContext.pipeline) {
    apiContext.pipeline = {
      withResponseShouldCacheBeServed: interpretGithubResponseIsCacheOk,
      withMetadataShouldCacheBeServed: usingMetadataIsCacheValid, // githubSkip,
      withResponseUpdateMetadata: updateMetadataWithResponse, // githubSkip,
      reduceMetadataToCacheFromResponse: githubReduceMetadataToCache,
      callApi: callGithubApi,
      getResponseMetadata: getGithubResponseMetadata,
      processMetadataBeforeCall: processGithubMetadataBeforeCall,
      finish: null,
      cache: {
        minutes: {
          longtermMetadata: longtermMetadataMinutes,
          longtermResponse: longtermResponseMinutes,
          acceleratedExpiration: acceleratedExpirationMinutes,
        },
        apiTypePrefix: 'github#',
      },
    };
  }
  apiContext.redisKey.root = core.redisKeyForApi(apiContext.pipeline.cache.apiTypePrefix, apiContext.api, apiContext.options);
  apiContext.redisKey.metadata =
    apiContext.redisKey.root ? apiContext.redisKey.root + core.redisKeyAspectSuffix('meta') :
      core.redisKeyForApi(apiContext.pipeline.cache.apiTypePrefix, apiContext.api, apiContext.options, 'meta');
  return apiContext;
}

/*
// TODO: Need to audit uses of github.post, github.call to figure out if this skip provider should still be used in places
function githubSkip() {
  // For direct GitHub calls we always go direct to GitHub with the e-tag
  return Q(false);
}
*/

function usingMetadataIsCacheValid(apiContext, metadata) {
  // result can be falsy OR an object; { cache: true, refresh: true }
  // cache: whether to use the cache, if available
  // refresh: whether to refresh in the background for a newer value
  let shouldServeCache = false;
  const maxAgeSeconds = apiContext.maxAgeSeconds;
  const updatedIso = metadata ? metadata.updated : null;
  const refreshingIso = metadata ? metadata.refreshing : null;
  if (metadata && !updatedIso) {
    debug(`${apiContext.redisKey.metadata} entity without updated date found`);
  }
  if (apiContext.generatedRefreshId) {
    debug(`${apiContext.redisKey.metadata} this is technically a refresh operation right now behind the scenes`);
  }
  if (maxAgeSeconds && updatedIso) {
    const updated = moment(updatedIso);
    const calledTime = apiContext.calledTime;
    if (updated.add(maxAgeSeconds, 'seconds').isAfter(calledTime)) {
      shouldServeCache = true;
      shouldServeCache = {
        cache: true,
        remaining: 'expires in ' + moment(updatedIso).add(maxAgeSeconds, 'seconds').fromNow(),
      };
      // debug('cache OK to serve as last updated was ' + updated);
    } else if (apiContext.backgroundRefresh) {
      let shouldRefresh = true;
      debug(apiContext.redisKey.metadata + ' need to go live as last updated ' + updated.format() + ' and our max seconds value is ' + maxAgeSeconds);
      if (refreshingIso) {
        let secondsToAllowForRefresh = 2 + (core.delayBeforeRefreshMilliseconds / 1000);
        if (Array.isArray(metadata.pages)) {
          secondsToAllowForRefresh += (metadata.pages.length * 1.25);
        }
        secondsToAllowForRefresh = Math.round(secondsToAllowForRefresh);
        const refreshWindow = moment(refreshingIso).add(secondsToAllowForRefresh, 'seconds');
        if (moment().utc().isAfter(refreshWindow)) {
          debug(`Another worker\'s refresh did not complete. Refreshing in this instance. ${apiContext.redisKey.metadata}`);
        } else {
          shouldRefresh = false;
          debug(`A refresh is already being processed by another worker. Allowing a window of ${secondsToAllowForRefresh}s before retry. ${apiContext.redisKey.metadata}`);
        }
      }
      shouldServeCache = {
        cache: true,
        refresh: shouldRefresh,
      };
    }
  } else {
    if (!metadata) {
      debug('api: empty/no metadata ' + apiContext.redisKey.metadata);
    } else {
      debug('api: no updated ' + apiContext.redisKey.metadata);
    }
  }
  return Q(shouldServeCache);
}

function processGithubMetadataBeforeCall(apiContext, metadata) {
  if (metadata && metadata.av && apiContext.libraryContext.breakingChangeGitHubPackageVersion && !semver.gt(metadata.av, apiContext.libraryContext.breakingChangeGitHubPackageVersion)) {
    console.log(`${apiContext.redisKey.metadata} was using ${metadata.av}, which is <= to ${apiContext.libraryContext.breakingChangeGitHubPackageVersion}. This is a schema break, discarding cache.`);
    metadata = undefined;
  } else if (metadata && !metadata.av) {
    // Old version of metadata, no package version, which is required for all GitHub REST API metadata now
    metadata = undefined;
  }
  if (metadata && metadata.etag) {
    apiContext.etag = metadata.etag;
    apiContext.metadata = metadata;
  }
  return metadata;
}

function callGithubApi(apiContext) {
  const token = apiContext.token;
  const headers = {
    Authorization: `token ${token}`,
  };
  if (apiContext.options.headers) {
    apiContext.headers = apiContext.options.headers;
    Object.assign(headers, apiContext.headers);
  }
  if (apiContext.etag) {
    headers['If-None-Match'] = apiContext.etag;
  }
  ++apiContext.cost.github.restApiCalls;
  const args = [];
  const apiMethod = apiContext.apiMethod;
  if (apiContext.fakeLink) {
    args.push(apiContext.fakeLink, headers);
  } else {
    const argOptions = Object.assign({}, apiContext.options);
    argOptions.headers = headers;
    args.push(argOptions);
  }
  const thisArgument = apiMethod.thisInstance || null;
  return apiMethod.apply(thisArgument, args);
}

function getGithubResponseMetadata(apiContext, response) {
  return Q(response.meta);
}

function interpretGithubResponseIsCacheOk(apiContext, response) {
  if (response === undefined) {
    throw new Error('The response was undefined and unable to process.');
  }
  if (!response.meta) {
    throw new Error('No metadata was provided alongside the GitHub API response.');
  }
  let retryAfter = response.meta['retry-after'];
  if (retryAfter) {
    debug(`Retry-After header was present: ${retryAfter}`);
  }
  const rateLimitRemaining = response.meta['x-ratelimit-remaining'];
  if (rateLimitRemaining) {
    apiContext.cost.github.remainingApiTokens = rateLimitRemaining;
  }
  let statusCode = 0;
  if (response && response.meta && response.meta.status) {
    let status = response.meta.status || '';
    let i = status.indexOf(' ');
    statusCode = parseInt(i >= 0 ? status.substr(0, i) : status);
    response.meta.statusActual = statusCode;
  }
  let cacheOk = false;
  if (statusCode === 304) {
    const displayInfo = apiContext.redisKey ? apiContext.redisKey.root : '';
    debug(`304: Use existing cache ${displayInfo}`);
    ++apiContext.cost.github.cacheHits;
    cacheOk = true;
  } else if (statusCode < 200 || statusCode >= 300) {
    // The underlying library I believe actually processes these conditions as errors anyway
    throw new Error(`Response code of ${statusCode} is not currently supported in this system.`);
  }
  return Q(cacheOk);
}

function githubReduceMetadataToCache(apiContext, response) {
  const metadata = response ? response.meta : null;
  if (metadata && metadata.etag) {
    let reduced = {
      etag: metadata.etag,
      av: appVersion, // added in app v5.0.1
    };
    console.log(`+ ${appVersion} adding app version to REST API caching metadata *NEW* ${apiContext.redisKey.metadata}`);
    if (metadata.link) {
      reduced.link = metadata.link;
    }
    /*
    let requestId = metadata['x-github-request-id'];
    if (requestId) {
      reduced['x-github-request-id'] = requestId;
    }
    */
    // CONSIDER: can parse last-modified and store it as 'changed' UTC

    let calledTime = apiContext.calledTime ? apiContext.calledTime.format() : moment().utc().format();
    reduced.updated = calledTime;
    return reduced;
  }
  return metadata;
}

function wrapCreatePage(libraryContext, github, kind) {
  return function(token, link, callback) {
    getPage(libraryContext, github, token, link, kind, callback);
  };
}

function getPage(libraryContext, github, token, link, which, callback) {
  const url = getPageLink(github, link.meta.link, which);
  if (!url) {
    return callback(new Error('No GitHub collection link was present in the response.'));
  }
  const apiContext = prepareApiContextForGithub(createApiContextFromLink(github, url), github);
  apiContext.token = token;
  apiContext.libraryContext = libraryContext;
  core.execute(apiContext, callback);
}

function getPageLink(github, link, which) {
  let method = null;
  switch (which) {
  case 'next':
    method = github.hasNextPage;
    break;
  case 'prev':
    method = github.hasPreviousPage;
    break;
  case 'last':
    method = github.hasLastPage;
    break;
  case 'first':
    method = github.hasFirstPage;
    break;
  default:
    return null;
  }
  if (method) {
    return method.call(github, link);
  }
}

module.exports = {
  create: createFullContext,
  wrapCreatePage: wrapCreatePage,
  findGitHubMethod: findGitHubMethod,
};
