//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

/*eslint no-console: ["error", { allow: ["dir", "warn"] }] */

'use strict';

const _ = require('lodash');
const debug = require('debug')('oss-github');
const uuid = require('node-uuid');
const moment = require('moment');
const Q = require('q');

const cost = require('./cost');

const delayBeforeRefreshMilliseconds = 1000;

// --- Core REST client cache functionality ---

function internalCall(apiContext, callback) {
  return getCachedMetadata(apiContext)
    .then(apiContext.pipeline.processMetadataBeforeCall.bind(null, apiContext))
    .then((metadata) => {
      return apiContext.pipeline.withMetadataShouldCacheBeServed(apiContext, metadata)
        .then((shouldCacheBeServedImmediately) => {
          const displayKey = apiContext.redisKey ? apiContext.redisKey.root + ' ' : '';
          if (shouldCacheBeServedImmediately === true || shouldCacheBeServedImmediately.cache === true) {
            if (metadata) {
              const innerMessage = shouldCacheBeServedImmediately && shouldCacheBeServedImmediately.remaining ? shouldCacheBeServedImmediately.remaining : '';
              debug(`OK cache ${displayKey}data: ${innerMessage}`);
            }
            ++apiContext.cost.github.cacheHits;
            return getCachedResult(apiContext, shouldCacheBeServedImmediately);
          } else {
            if (metadata) {
              // console.dir(metadata);
            }
            debug(`API GET : ${displayKey}`);
            return apiContext.pipeline.callApi(apiContext)
              .then(processResponse.bind(null, apiContext));
          }
        })
        .then(result => {
          callback(null, result);
        }, callback);
    });
}

function processResponse(apiContext, response) {
  return apiContext.pipeline.withResponseUpdateMetadata(apiContext, response)
  .then(apiContext.pipeline.withResponseShouldCacheBeServed.bind(null, apiContext, response))
  .then((isCacheOk) => {
    if (isCacheOk === true) {
      ++apiContext.cost.github.cacheHits;
      return getCachedResult(apiContext);
    }
    ++apiContext.cost.github.usedApiTokens;
    return apiContext.pipeline.getResponseMetadata(apiContext, response).then((metadata) => {
      if (metadata) {
        return cacheResponseAsync(apiContext, response); // callback will happen after caching
      } else {
        finish(apiContext);
        return finalizeResult(apiContext, response);
      }
    });
  });
}

function finish(apiContext) {
  if (apiContext && apiContext.pipeline && apiContext.pipeline.finish) {
    apiContext.pipeline.finish(apiContext);
  }
}

// --- Caching integration with metadata/responses ---

function getCachedMetadata(apiContext) {
  if (apiContext.metadata || apiContext.etag) {
    return;
  }
  const redisKey = apiContext.redisKey.metadata;
  if (!redisKey) {
    throw new Error('No Redis key provided in apiContext.redisKey.metadata');
  }
  return apiContext.libraryContext.redis.getObjectAsync(redisKey)
  .then(recordRedisCost(apiContext, 'get'));
}

function tryGetCachedResult(apiContext) {
  const key = redisKeyBodyVersion(apiContext);
  if (apiContext.libraryContext.memoryCache.has(key)) {
    ++apiContext.cost.local.cacheHits;
    return Q(apiContext.libraryContext.memoryCache.get(key));
  }
  ++apiContext.cost.local.cacheMisses;
  return apiContext.libraryContext.redis.getObjectCompressedAsync(redisKeyBodyVersion(apiContext))
    .then(recordRedisCost(apiContext, 'get'))
    .then(storeLocalResult.bind(null, apiContext));
}

function getCachedResult(apiContext, optionalCacheDecisions) {
  return tryGetCachedResult(apiContext)
    .then(result => {
      if (result) {
        result.meta = apiContext.metadata;
        if (optionalCacheDecisions && optionalCacheDecisions.refresh === true) {
          backgroundRefreshAsync(apiContext, apiContext.metadata);
        } else {
          slideObjectExpirationWindow(apiContext).then(finish(apiContext));
        }
        return finalizeResult(apiContext, result);
      }
      ++apiContext.cost.redis.cacheMisses;
      delete apiContext.etag;
      return apiContext.pipeline.callApi(apiContext).then(processResponse.bind(null, apiContext));
    });
}

function backgroundRefreshAsync(apiContext, currentMetadata) {
  // Potential data loss/consistency problem: upsert/overwrite
  let refreshing = moment().utc().format();
  let refreshId = uuid();
  currentMetadata.refreshing = refreshing;
  currentMetadata.refreshId = refreshId;
  apiContext.generatedRefreshId = refreshId;
  debug(`refresh in the background starting for ${apiContext.redisKey.metadata} was updated ${apiContext.metadata.updated} and seconds of ${apiContext.maxAgeSeconds}`);
  return apiContext.libraryContext.redis.setObjectWithExpireAsync(apiContext.redisKey.metadata, currentMetadata, apiContext.pipeline.cache.minutes.longtermMetadata)
    .then(() => {
      // Remove the values in case the refresh uses the metadata
      delete currentMetadata.refreshing;
      delete currentMetadata.refreshId;
    })
    .then(recordRedisCost(apiContext, 'set'))
    .delay(delayBeforeRefreshMilliseconds)
    .then(apiContext.pipeline.callApi.bind(null, apiContext))
    .then(processResponse.bind(null, apiContext))
    .catch(exp => {
      console.dir(exp);
    });
}

function cacheResponseAsync(apiContext, response) {
  const kickoffAsyncWork = () => {
    return storeLocalResult(apiContext, response)
    .then(storeResult(apiContext, response))
    .then(storeMetadata(apiContext, response))
    .then(reduceObjectExpirationWindow(apiContext, response))
    .catch((err) => {
      if (err) {
        console.dir(err);
      }
    }).done(() => {
      return finish(apiContext);
    });
  };
  kickoffAsyncWork();
  return finalizeResult(apiContext, response);
}

function finalizeResult(apiContext, response) {
  if (!response || !response.data) {
    // This was a warning in the past, but to try and improve the underlying library, this should be an error
    const warning = `${apiContext.redisKey.root} : no response or no response.data`;
    console.warn(warning);
    throw new Error(warning);
  }
  // If there are situations where you do not want the cost shared
  // back the API context could be customized here.
  if (response) {
    response.cost = apiContext.cost;
  }
  return response;
}

// --- Caching ---

function reduceObjectExpirationWindow(apiContext, response) {
  if (!apiContext.etag || (apiContext.etag && apiContext.etag === response.meta.etag)) {
    return;
  }
  debug('Expiring older cached response');
  return apiContext.libraryContext.redis.expireAsync(
    redisKeyBodyVersion(apiContext, apiContext.etag),
    apiContext.pipeline.cache.minutes.acceleratedExpiration)
  .then(recordRedisCost(apiContext, 'expire'));
}

function slideObjectExpirationWindow(apiContext) {
  if (!apiContext.etag) {
    return undefined;
  }
  return apiContext.libraryContext.redis.expireAsync(
    redisKeyBodyVersion(apiContext, apiContext.etag),
    apiContext.pipeline.cache.minutes.longtermResponse)
  .then(recordRedisCost(apiContext, 'expire'));
}

function storeMetadata(apiContext, response) {
  const reducedMetadata = apiContext.pipeline.reduceMetadataToCacheFromResponse(apiContext, response);
  return apiContext.libraryContext.redis.setObjectWithExpireAsync(
    apiContext.redisKey.metadata,
    reducedMetadata,
    apiContext.pipeline.cache.minutes.longtermMetadata)
  .then(recordRedisCost(apiContext, 'set'));
}

function storeLocalResult(apiContext, response) {
  return new Q.Promise(function(resolve) {
    if (response) {
      const key = redisKeyBodyVersion(apiContext, response && response.meta ? response.meta.etag : undefined);
      apiContext.libraryContext.memoryCache.set(key, response);
    }
    resolve(response);
  });
}

function storeResult(apiContext, response) {
  let key = null;
  try {
    key = redisKeyBodyVersion(apiContext, response.meta.etag);
  } catch (noKey) {
    return Q();
  }
  return apiContext.libraryContext.redis.setObjectCompressedWithExpireAsync(
    key,
    response,
    apiContext.pipeline.cache.minutes.longtermResponse)
    .then(recordRedisCost(apiContext, 'set'));
}

function redisKeyAspectSuffix(aspect) {
  return aspect ? `:${aspect}` : '';
}

function redisKeyBodyVersion(apiContext, etag) {
  const tag = etag || apiContext.etag;
  if (!tag) {
    throw new Error('A cached result cannot be retrieved without an etag value.');
  }
  const strippedTag = tag.replace(/"/g, '');
  const root = apiContext.redisKey.root;
  if (!root) {
    throw new Error('No Redis key root provided in API context apiContext.redisKey.root');
  }
  return root + redisKeyAspectSuffix(`body@${strippedTag}`);
}

function recordRedisCost(apiContext, type) {
  if (!type) {
    throw new Error('No type defined for recordRedisCost.');
  }
  return object => {
    let hit = object !== undefined;
    if (type === 'get') {
      apiContext.cost.redis.cacheHit += hit ? 1 : 0;
      apiContext.cost.redis.cacheMisses += hit ? 0 : 1;
    }
    if (type !== 'get' && type !== 'set' && type !== 'expire') {
      throw new Error(`The Redis type of ${type} is not configured for storing API costs.`);
    }
    apiContext.cost.redis[`${type}Calls`] += 1;
    return object;
  };
}

function decorateApiContext(apiContext) {
  // Decorate with expected variables to hold logs, cost
  if (!apiContext.log) {
    apiContext.log = [];
  }
  if (!apiContext.calledTime) {
    apiContext.calledTime = moment().utc();
  }
  if (!apiContext.redisKey) {
    apiContext.redisKey = {};
  }
  if (!apiContext.cost) {
    apiContext.cost = cost.create();
  }
  return apiContext;
}

function createContext(api, options) {
  const apiContext = {
    api: api,
    options: options,
  };
  return decorateApiContext(apiContext);
}

function redisKeyForApi(apiPrefix, api, apiOptions, aspect) {
  const normalizedOptions = normalizedOptionsString(apiOptions);
  const aspectSuffix = redisKeyAspectSuffix(aspect);
  return `${apiPrefix}${api}${normalizedOptions}${aspectSuffix}`;
}

function normalizedOptionsString(options) {
  if (!options) {
    return '';
  }
  const sortedkeys = _.keys(options).sort();
  let normalized = [];
  sortedkeys.forEach((key) => {
    let value = options[key];
    const typeOf = typeof (value);
    if (typeOf === 'object') {
      value = normalizedOptionsString(value);
    } else if (typeOf !== 'string' && typeOf !== 'number' && typeOf !== 'boolean') {
      throw new Error(`Normalized option ${key} is not a string`);
    }
    if (typeOf === 'boolean') {
      value = value === true ? '1' : '0';
    }
    normalized.push(`${key}=${value}`);
  });
  return `(${normalized.join(',')})`;
}

function projectFlatObjectWithData(entity) {
  const flat = entity.data;
  if (entity.cost) {
    flat.cost = entity.cost;
  }
  if (entity.meta) {
    flat.meta = entity.meta;
  }
  return flat;
}

function createCallbackFlattenDataOptionally(callback) {
  return function callbackFlatEntityFromDataOptionally(error, entity) {
    if (error) {
      return callback(error);
    }
    if (!entity) {
      return callback(null, entity);
    }
    if (entity.data !== undefined && !entity.data) {
      // If it's an empty string, or false, etc., return the value directly
      return callback(null, entity.data);
    }
    const flat = projectFlatObjectWithData(entity);
    return callback(null, flat);
  };
}

function createCallbackFlattenData(callback) {
  return function callbackFlatEntityFromData(error, entity) {
    if (!error && entity && !entity.data) {
      error = new Error('No entity.data present in the result, cannot flatten the object');
    }
    if (error) {
      return callback(error);
    }
    const flat = projectFlatObjectWithData(entity);
    return callback(null, flat);
  };
}

module.exports = {
  execute: internalCall,
  createContext: createContext,
  createCallbackFlattenData: createCallbackFlattenData,
  createCallbackFlattenDataOptionally: createCallbackFlattenDataOptionally,
  redisKeyAspectSuffix: redisKeyAspectSuffix,
  redisKeyForApi: redisKeyForApi,
  delayBeforeRefreshMilliseconds: delayBeforeRefreshMilliseconds,
};
