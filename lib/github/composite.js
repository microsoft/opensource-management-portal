//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

/*eslint no-console: ["error", { allow: ["log"] }] */

'use strict';

// Composite method/filter/call memoization

const debug = require('debug')('oss-github');
const uuid = require('node-uuid');
const moment = require('moment');
const semver = require('semver');
const Q = require('q');

const appPackage = require('../../package');
const appVersion = appPackage.version;

const core = require('./core');

const longtermMinutes = 60 * 24 * 7; // 7 days
const acceleratedExpirationMinutes = 60; // 1 hour

function metadataFromResponse(apiContext, response) {
  const meta = response.meta || {};
  let calledTime = apiContext.calledTime ? apiContext.calledTime.format() : moment().utc().format();
  meta.updated = calledTime;
  let changed = calledTime;
  if (meta.dirty === true) {
    changed = calledTime;
  } else if (meta.dirty === false && apiContext.previouslyChanged) {
    changed = apiContext.previouslyChanged;
  }
  meta.changed = changed;
  meta.etag = apiContext.generatedRefreshId || uuid();
  delete meta.dirty;
  return Q(meta);
}

function processMetadataBeforeCall(apiContext, metadata) {
  if (metadata && !metadata.av) {
    // Old version of metadata, no package version, which is required for all composite metadata now
    metadata = undefined;
  } else if (metadata && metadata.av && apiContext.libraryContext.breakingChangeGitHubPackageVersion && !semver.gt(metadata.av, apiContext.libraryContext.breakingChangeGitHubPackageVersion)) {
    console.log(`${apiContext.redisKey.metadata} was using ${metadata.av}, which is <= to ${apiContext.libraryContext.breakingChangeGitHubPackageVersion}. This is a schema break, discarding cache.`);
    metadata = undefined;
  }
  if (metadata && metadata.etag) {
    apiContext.etag = metadata.etag;
    apiContext.metadata = metadata;
  }
  if (metadata && metadata.changed) {
    apiContext.previouslyChanged = metadata.changed;
  }
  return metadata;
}

function updateMetadataWithResponse(apiContext, response) {
  return Q(response);
}

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
      let reason = metadata === undefined ? 'undefined' : 'unknown';
      if (metadata === false) {
        reason = 'false value';
      } else if (metadata === null) {
        reason = 'null value';
      }
      debug(`composite: no metadata for key ${apiContext.redisKey.metadata} (${reason})`);
    } else {
      debug(`composite: no updated for key ${apiContext.redisKey.metadata} (but metadata present)`);
    }
  }
  return Q(shouldServeCache);
}

function usingResponseIsCacheValid(apiContext, response) {
  if (response === undefined) {
    throw new Error(`${apiContext.redisKey.metadata}: the response was undefined and unable to process`);
  }
  if (!response.meta) {
    throw new Error(`${apiContext.redisKey.metadata}: no metadata was provided alongside the API response`);
  }
  let shouldUseCache = false;
  apiContext.etag = response.meta.etag;

  // Probably should check; if original data has not changed at all, then return true.
  if (response && response.meta && response.meta.updated === false) {
    shouldUseCache = true;
  }

  return Q(shouldUseCache);
}

function compositeCall(apiContext) {
  const args = [];
  const apiMethod = apiContext.apiMethod;
  if (apiContext.token) {
    args.push(apiContext.token);
  }
  const argOptions = Object.assign({}, apiContext.options);
  args.push(argOptions);
  const thisArgument = apiMethod.thisInstance || null;
  return apiMethod.apply(thisArgument, args);
}

function reduceMetadataBeforeCaching(apiContext, response) {
  // No reduction for object type metadata.
  // Store the app version in case it is needed for a future
  // schema update or cache invalidation
  if (response.meta) {
    response.meta.av = appVersion;
    return response.meta;
  }
}

function createApiContextForObject(api, apiMethod, options) {
  const customApiTypePrefix = options.apiTypePrefix;
  if (customApiTypePrefix) {
    delete options.apiTypePrefix;
  }
  const apiContext = core.createContext(api, options);
  apiContext.apiMethod = apiMethod;
  apiContext.pipeline = {
    withMetadataShouldCacheBeServed: usingMetadataIsCacheValid,
    withResponseShouldCacheBeServed: usingResponseIsCacheValid,
    withResponseUpdateMetadata: updateMetadataWithResponse,
    reduceMetadataToCacheFromResponse: reduceMetadataBeforeCaching,
    callApi: compositeCall,
    getResponseMetadata: metadataFromResponse,
    processMetadataBeforeCall: processMetadataBeforeCall,
    cache: {
      minutes: {
        longtermMetadata: longtermMinutes,
        longtermResponse: longtermMinutes,
        acceleratedExpiration: acceleratedExpirationMinutes,
      },
      apiTypePrefix: customApiTypePrefix || 'github.col#',
    },
    finish: null,
  };
  apiContext.redisKey.root = core.redisKeyForApi(apiContext.pipeline.cache.apiTypePrefix, apiContext.api, apiContext.options);
  apiContext.redisKey.metadata =
    apiContext.redisKey.root ? apiContext.redisKey.root + core.redisKeyAspectSuffix('meta') :
      core.redisKeyForApi(apiContext.pipeline.cache.apiTypePrefix, apiContext.api, apiContext.options, 'meta');
  return apiContext;
}

module.exports = {
  create: createApiContextForObject,
};
