//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

// Composite method/filter/call memoization

import { randomUUID } from 'crypto';
import moment from 'moment';
import semver from 'semver';

import Debug from 'debug';
const debug = Debug.debug('restapi');

import {
  ShouldServeCache,
  ApiContext,
  IntelligentEngine,
  IApiContextRedisKeys,
  IApiContextCacheValues,
  ApiContextType,
  RestMetadata,
  RestResponse,
} from './core.js';
import { GetAuthorizationHeader } from '../../interfaces/index.js';

import appPackage from '../../package.json' with { type: 'json' };
import { CreateError } from '../transitional.js';

const appVersion = appPackage.version;

const longtermMinutes = 60 * 24 * 7; // 7 days
const acceleratedExpirationMinutes = 60; // 1 hour

export class CompositeApiContext extends ApiContext {
  private _apiMethod: any;
  private _apiTypePrefix: string;
  private _token: string | GetAuthorizationHeader;
  private _cacheValues: IApiContextCacheValues;
  private _redisKeys: IApiContextRedisKeys;

  previouslyChanged: any;

  constructor(api: any, apiMethod: any, options: any) {
    super(api, options);

    const customApiTypePrefix = this.options.apiTypePrefix;
    if (customApiTypePrefix) {
      delete this.options.apiTypePrefix;
    }

    this._apiMethod = apiMethod;
    this._apiTypePrefix = customApiTypePrefix || 'github.col#';

    const root = IntelligentEngine.redisKeyForApi(this.apiTypePrefix, api, options);
    this._redisKeys = {
      root: root,
      metadata: root
        ? root + IntelligentEngine.redisKeyAspectSuffix('headers')
        : IntelligentEngine.redisKeyForApi(this.apiTypePrefix, api, options, 'headers'),
    };

    this._cacheValues = {
      longtermMetadata: longtermMinutes,
      longtermResponse: longtermMinutes,
      acceleratedExpiration: acceleratedExpirationMinutes,
    };
  }

  get redisKey(): IApiContextRedisKeys {
    return this._redisKeys;
  }

  get cacheValues(): IApiContextCacheValues {
    return this._cacheValues;
  }

  get token(): string | GetAuthorizationHeader {
    return this._token;
  }

  overrideToken(token: string | GetAuthorizationHeader) {
    this._token = token;
  }

  get apiMethod(): any {
    return this._apiMethod;
  }

  get apiTypePrefix(): string {
    return this._apiTypePrefix;
  }

  get contextType(): ApiContextType {
    return ApiContextType.Composite;
  }
}

export class CompositeIntelligentEngine extends IntelligentEngine {
  withMetadataShouldCacheBeServed(
    apiContext: ApiContext,
    metadata: RestMetadata
  ): boolean | ShouldServeCache {
    // result can be falsy OR an object; { cache: true, refresh: true }
    // cache: whether to use the cache, if available
    // refresh: whether to refresh in the background for a newer value
    let shouldServeCache: ShouldServeCache | boolean = false;
    const maxAgeSeconds = apiContext.maxAgeSeconds;
    const updatedIso = metadata ? metadata.updated : null;
    const refreshingIso = metadata ? metadata.refreshing : null;
    if (metadata && !updatedIso) {
      debug(`${apiContext.redisKey.metadata} entity without updated date found`);
    }
    if (apiContext.generatedRefreshId) {
      debug(
        `${apiContext.redisKey.metadata} this is technically a refresh operation right now behind the scenes`
      );
    }
    if (maxAgeSeconds && updatedIso) {
      const updated = moment(updatedIso);
      const calledTime = apiContext.calledTime;
      if (updated.add(maxAgeSeconds, 'seconds').isAfter(calledTime)) {
        shouldServeCache = true;
        shouldServeCache = {
          cache: true,
          remaining: 'expires ' + moment(updatedIso).add(maxAgeSeconds, 'seconds').fromNow(),
        };
        // debug('cache OK to serve as last updated was ' + updated);
      } else if (apiContext.backgroundRefresh) {
        let shouldRefresh = true;
        debug(
          apiContext.redisKey.metadata +
            ' need to go live as last updated ' +
            updated.format() +
            ' and our max seconds value is ' +
            maxAgeSeconds
        );
        if (refreshingIso) {
          let secondsToAllowForRefresh = 2 + apiContext.delayBeforeRefreshMilliseconds / 1000;
          if (Array.isArray(metadata.pages)) {
            secondsToAllowForRefresh += metadata.pages.length * 1.25;
          }
          secondsToAllowForRefresh = Math.round(secondsToAllowForRefresh);
          const refreshWindow = moment(refreshingIso).add(secondsToAllowForRefresh, 'seconds');
          if (moment().utc().isAfter(refreshWindow)) {
            debug(
              `Another worker's refresh did not complete. Refreshing in this instance. ${apiContext.redisKey.metadata}`
            );
          } else {
            shouldRefresh = false;
            debug(
              `A refresh is already being processed by another worker. Allowing a window of ${secondsToAllowForRefresh}s before retry. ${apiContext.redisKey.metadata}`
            );
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
        if ((metadata as unknown as boolean) === false) {
          reason = 'false value';
        } else if (metadata === null) {
          reason = 'null value';
        }
        debug(`composite: no metadata for key ${apiContext.redisKey.metadata} (${reason})`);
      } else {
        debug(`composite: no updated for key ${apiContext.redisKey.metadata} (but metadata present)`);
      }
    }
    return shouldServeCache;
  }

  withResponseShouldCacheBeServed(apiContext: ApiContext, response: RestResponse) {
    if (typeof response === 'function') {
      throw new Error('The response must not be a function');
    }
    if (response === undefined) {
      throw new Error(`${apiContext.redisKey.metadata}: the response was undefined and unable to process`);
    }
    if (!response.headers) {
      throw new Error(`${apiContext.redisKey.metadata}: no metadata was provided alongside the API response`);
    }
    const shouldUseCache = false;
    apiContext.etag = response.headers.etag;

    // Probably should check; if original data has not changed at all, then return true.
    // XXX: cannot find updated ever being set to false but...?
    debug(
      'composite.withResponseShouldCacheBeServed: not checking for updated = false so never serving cache'
    );
    // if (response && response.headers && response.headers.updated === false) {
    //   shouldUseCache = true;
    // }

    return shouldUseCache;
  }

  optionalStripResponse(apiContext: ApiContext, response: RestResponse): RestResponse {
    // Composite does not strip any results further before caching
    return response;
  }

  withResponseUpdateMetadata(apiContext: ApiContext, response: RestResponse) {
    return response;
  }

  reduceMetadataToCacheFromResponse(apiContext: ApiContext, response: RestResponse) {
    // No reduction for object type metadata.
    // Store the app version in case it is needed for a future
    // schema update or cache invalidation
    if (response.headers) {
      response.headers.av = appVersion;
      return response.headers;
    }
  }

  async callApi(apiContext: CompositeApiContext): Promise<RestResponse> {
    const args = [];
    const apiMethod = apiContext.apiMethod;
    if (apiContext.token) {
      args.push(apiContext.token);
    }
    const argOptions = Object.assign({}, apiContext.options);
    args.push(argOptions);
    const thisArgument = apiMethod.thisInstance || null;
    let unknown = undefined;
    try {
      if (!apiMethod || !apiMethod.apply) {
        throw CreateError.InvalidParameters('apiMethod');
      }
      unknown = await apiMethod.apply(thisArgument, args);
    } catch (applyError) {
      throw applyError;
    }
    return unknown as RestResponse;
  }

  getResponseMetadata(apiContext: CompositeApiContext, response: RestResponse): RestMetadata {
    const headers = response.headers || {};
    const calledTime = apiContext.calledTime ? apiContext.calledTime.toISOString() : new Date().toISOString();
    headers.updated = calledTime;
    let changed = calledTime;
    if (headers.dirty === true) {
      changed = calledTime;
    } else if (headers.dirty === false && apiContext.previouslyChanged) {
      changed = apiContext.previouslyChanged;
    }
    headers.changed = changed;
    headers.etag = apiContext.generatedRefreshId || randomUUID();
    delete headers.dirty;
    return headers;
  }

  processMetadataBeforeCall(apiContext: CompositeApiContext, metadata: RestMetadata) {
    if (metadata && !metadata.av) {
      // Old version of metadata, no package version, which is required for all composite metadata now
      metadata = undefined;
    } else if (
      metadata &&
      metadata.av &&
      apiContext.libraryContext.breakingChangeGitHubPackageVersion &&
      !semver.gte(metadata.av, apiContext.libraryContext.breakingChangeGitHubPackageVersion)
    ) {
      console.log(
        `${apiContext.redisKey.metadata} was using ${metadata.av}, which is < to ${apiContext.libraryContext.breakingChangeGitHubPackageVersion}. This is a schema break, discarding cache.`
      );
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
}
