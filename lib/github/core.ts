//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

/*eslint no-console: ["error", { allow: ["dir", "warn"] }] */

'use strict';

import _ from 'lodash';
const debug = require('debug')('restapi');
import { v4 as uuidV4 } from 'uuid';
import moment from 'moment';
import { RestLibrary } from '.';
import { IAuthorizationHeaderValue, ErrorHelper } from '../../transitional';
import { sleep } from '../../utils';

const cost = require('./cost');

const delayBeforeRefreshMilliseconds = 1000;

const delayBeforeRequestMilliseconds = false; // useful during cache fill: 2 * 1000;

// --- Intelligent cache object interfaces ---

export interface IIntelligentCacheObjectResponse {
  headers?: any;
  cost?: any;
}

export enum ApiContextType {
  Composite,
  GitHubRestApi,
}

export interface IIntelligentCacheResponseArray extends Array<any>, IIntelligentCacheObjectResponse {
}

export interface IInteligentEngineResponse {
}

export interface IIntelligentCacheMetadata {
}

export interface IShouldServeCache {
  cache?: boolean;
  remaining?: string;
  refresh?: boolean;
}

export abstract class ApiContext {
  private _log: string[];
  private _calledTime: moment.Moment;
  private _cost: any;

  libraryContext: RestLibrary;
  etag?: string;
  tokenSource: IAuthorizationHeaderValue;

  abstract get apiTypePrefix(): string;
  abstract get cacheValues(): IApiContextCacheValues;
  abstract get redisKey(): IApiContextRedisKeys;
  abstract get contextType(): ApiContextType;

  get calledTime(): moment.Moment {
    return this._calledTime;
  }

  get delayBeforeRefreshMilliseconds(): number {
    return delayBeforeRefreshMilliseconds;
  }

  get log(): string[] {
    return this._log;
  }

  get cost(): any {
    return this._cost;
  }

  constructor(public api: any, public options: any) {
    this._log = [];
    if (!this._calledTime) {
      this._calledTime = moment().utc();
    }
    if (!this._cost) {
      this._cost = cost.create();
    }
  }

  maxAgeSeconds?: number;
  backgroundRefresh?: boolean;

  metadata?: any;

  generatedRefreshId?: string;
};

export interface IApiContextRedisKeys {
  metadata: string;
  root: string;
}

export interface IApiContextCacheValues {
  longtermMetadata: number;
  longtermResponse: number;
  acceleratedExpiration: number;
}

export abstract class IntelligentEngine {
  public static redisKeyAspectSuffix(aspect: string): string {
    return aspect ? `:${aspect}` : '';
  }

  public static redisKeyForApi(apiPrefix: string, api: string, apiOptions, aspect?: string) {
    const normalizedOptions = normalizedOptionsString(apiOptions);
    const aspectSuffix = IntelligentEngine.redisKeyAspectSuffix(aspect);
    return `${apiPrefix}${api}${normalizedOptions}${aspectSuffix}`;
  }

  constructor() {
  }

  // was in api context:
  abstract async processMetadataBeforeCall(apiContext: ApiContext, metadata: any);
  abstract async callApi(apiContext: ApiContext, optionalMessage?: string): Promise<any>;
  abstract async withResponseUpdateMetadata(apiContext: ApiContext, response: any);

  abstract withResponseShouldCacheBeServed(apiContext: ApiContext, response: any) : boolean | IShouldServeCache;
  abstract withMetadataShouldCacheBeServed(apiContext: ApiContext, metadata: any): boolean | IShouldServeCache;
  abstract reduceMetadataToCacheFromResponse(apiContext: ApiContext, response: any): any;
  abstract getResponseMetadata(apiContext: ApiContext, response: any): any;
  abstract optionalStripResponse(apiContext: ApiContext, response: any): any;

  protected async cacheResponseAsync(apiContext: ApiContext, response) {
    const kickoffAsyncWork = async () => {
      try {
        await this.storeLocalResult(apiContext, response);
        await this.storeResult(apiContext, response);
        await this.storeMetadata(apiContext, response);
        await this.reduceObjectExpirationWindow(apiContext, response);
      } catch (err) {
        if (err) {
          console.dir(err);
        }
      }
      this.finish(apiContext);
    };
    kickoffAsyncWork();
    return this.finalizeResult(apiContext, response);
  }

  protected finalizeResult(apiContext: ApiContext, response: any): any {
    if (!response || !response.data) {
      // This was a warning in the past, but to try and improve the underlying library, this should be an error
      const reason = !response ? 'no response' : 'no response.data';
      const warning = `${apiContext.redisKey.root} : ${reason}`;
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

  protected finish(apiContext) {
    if (apiContext && apiContext.pipeline && apiContext.pipeline.finish) {
      apiContext.pipeline.finish(apiContext);
    }
  }

  protected async tryGetCachedResult(apiContext): Promise<any> {
    const key = this.redisKeyBodyVersion(apiContext);
    const response = await apiContext.libraryContext.redis.getObjectCompressed(this.redisKeyBodyVersion(apiContext));
    this.recordRedisCost(apiContext, 'get', response);
    await this.storeLocalResult(apiContext, response);
    return response;
  }

  protected async getCachedResult(apiContext: ApiContext, optionalCacheDecisions?): Promise<any> {
    let result = await this.tryGetCachedResult(apiContext);
    if (result) {
      result.headers = apiContext.metadata;
      if (optionalCacheDecisions && optionalCacheDecisions.refresh === true) {
        // NOTE: this kicks off the refresh and so does not await
        this.backgroundRefreshAsync(apiContext, apiContext.metadata);
      } else {
        this.slideObjectExpirationWindow(apiContext);
      }
      this.finish(apiContext);
      return this.finalizeResult(apiContext, result);
    }
    ++apiContext.cost.redis.cacheMisses;
    delete apiContext.etag;

    let response = await this.callApi(apiContext);
    response = this.processResponse(apiContext, response);
    return response;
  }

  protected async backgroundRefreshAsync(apiContext: ApiContext, currentMetadata) {
    // Potential data loss/consistency problem: upsert/overwrite
    try {
      let refreshing = moment().utc().format();
      let refreshId = uuidV4();
      currentMetadata.refreshing = refreshing;
      currentMetadata.refreshId = refreshId;
      apiContext.generatedRefreshId = refreshId;
      debug(`refresh in the background starting for ${apiContext.redisKey.metadata} was updated ${apiContext.metadata.updated} and seconds of ${apiContext.maxAgeSeconds}`);
      // TODO: use proper next tick to kick this off?
      const setReturnValue = await apiContext.libraryContext.redis.setObjectWithExpire(apiContext.redisKey.metadata, currentMetadata, apiContext.cacheValues.longtermMetadata);
      // Remove the values in case the refresh uses the metadata
      delete currentMetadata.refreshing;
      delete currentMetadata.refreshId;
      this.recordRedisCost(apiContext, 'set', setReturnValue);
      await sleep(delayBeforeRefreshMilliseconds);
      let response = await this.callApi(apiContext);
      response = await this.processResponse(apiContext, response);
      // ? anything to return... I don't think so
    } catch (backgroundError) {
      if (backgroundError.status === 404) {
        // gone entity
      } else if (backgroundError.status === 304) {
        // did not change
      } else {
        console.dir(backgroundError);
      }
    }
  }

  // --- Caching ---

  protected async reduceObjectExpirationWindow(apiContext: ApiContext, response): Promise<void> {
    if (!apiContext.etag || (apiContext.etag && apiContext.etag === response.headers.etag)) {
      return;
    }
    debug('Expiring older cached response');

    const cost = await apiContext.libraryContext.redis.expire(
      this.redisKeyBodyVersion(apiContext, apiContext.etag),
      apiContext.cacheValues.acceleratedExpiration);
    this.recordRedisCost(apiContext, 'expire', cost);
  }

  protected async slideObjectExpirationWindow(apiContext: ApiContext): Promise<void> {
    if (!apiContext.etag) {
      return;
    }
    const cost = await apiContext.libraryContext.redis.expire(
      this.redisKeyBodyVersion(apiContext, apiContext.etag),
      apiContext.cacheValues.longtermResponse);
    this.recordRedisCost(apiContext, 'expire', cost);
  }

  protected async storeMetadata(apiContext: ApiContext, response): Promise<void> {
    const reducedMetadata = this.reduceMetadataToCacheFromResponse(apiContext, response);
    const cost = await apiContext.libraryContext.redis.setObjectWithExpire(
      apiContext.redisKey.metadata,
      reducedMetadata,
      apiContext.cacheValues.longtermMetadata);
    this.recordRedisCost(apiContext, 'set', cost);
  }

  protected async storeLocalResult(apiContext: ApiContext, response): Promise<any> {
    if (response) {
      const key = this.redisKeyBodyVersion(apiContext, response && response.headers ? response.headers.etag : undefined);
    }
    return response;
  }

  protected async storeResult(apiContext: any, response: any): Promise<void> {
    let key = null;
    try {
      key = this.redisKeyBodyVersion(apiContext, response.headers.etag);
    } catch (noKey) {
      return;
    }
    const cost = await apiContext.libraryContext.redis.setObjectCompressedWithExpire(
      key,
      response,
      apiContext._cacheValues.longtermResponse);
    this.recordRedisCost(apiContext, 'set', cost);
  }

  protected redisKeyBodyVersion(apiContext: any, etag?: string): string {
    const tag = etag || apiContext.etag;
    if (!tag) {
      throw new Error('A cached result cannot be retrieved without an etag value.');
    }
    const strippedTag = tag.replace(/"/g, '');
    const root = apiContext.redisKey.root;
    if (!root) {
      throw new Error('No Redis key root provided in API context apiContext.redisKey.root');
    }
    return root + IntelligentEngine.redisKeyAspectSuffix(`body@${strippedTag}`);
  }

  protected recordRedisCost(apiContext: any, type: string, object: any): any {
    if (!type) {
      throw new Error('No type defined for recordRedisCost.');
    }
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
  }

  // this can just move to the parent class in time
  public async execute(apiContext: ApiContext): Promise<IInteligentEngineResponse> {

    let metadata = await this.getCachedMetadata(apiContext);

    metadata = this.processMetadataBeforeCall(apiContext, metadata);

    const shouldCacheBeServedImmediately: boolean | IShouldServeCache = await this.withMetadataShouldCacheBeServed(apiContext, metadata);

    const displayKey = apiContext.redisKey ? apiContext.redisKey.root + ' ' : '';

    if (shouldCacheBeServedImmediately === true || (shouldCacheBeServedImmediately as IShouldServeCache).cache === true) {
      if (metadata) {
        const innerMessage = shouldCacheBeServedImmediately && (shouldCacheBeServedImmediately as IShouldServeCache).remaining ? ((shouldCacheBeServedImmediately as IShouldServeCache).remaining) : '';
        debug(`OK cache ${displayKey}data: ${innerMessage}`);
      }
      ++apiContext.cost.github.cacheHits;
      return this.getCachedResult(apiContext, shouldCacheBeServedImmediately);
    }

    if (delayBeforeRequestMilliseconds) {
      debug(`DELAY...: ${displayKey} ${delayBeforeRefreshMilliseconds}`);
      await sleepPromise(delayBeforeRefreshMilliseconds);
    }

    let response;
    try {
      response = await this.callApi(apiContext, `GET:               ${displayKey}`);
    } catch (error) {
      if (error && error.status && error.status === 304) {
        // As of Octokit 14.0.0, 304 is exception/an error
        // As of Octokit 16.0.1, code is now status
        const keysWanted = [
          'etag',
          'status',
          'x-github-request-id',
          'x-ratelimit-limit',
          'x-ratelimit-remaining',
          'x-ratelimit-reset',
        ];
        const headers = error.headers || {};
        const meta = {};
        for (let i = 0; i < keysWanted.length; i++) {
          const key = keysWanted[i];
          if (headers[key]) {
            meta[key] = headers[key];
          }
        }
        const notModifiedResponse = { data: undefined, headers: meta };
        response = notModifiedResponse;
      } else {
        throw error;
      }
    }

    response = await this.processResponse(apiContext, response);
    return response;
  }

  private async processResponse(apiContext: ApiContext, response) {
    await this.withResponseUpdateMetadata(apiContext, response);
    const isCacheOk = this.withResponseShouldCacheBeServed(apiContext, response);

    if (isCacheOk === true) {
      ++apiContext.cost.github.cacheHits;
      return this.getCachedResult(apiContext);
    }
    ++apiContext.cost.github.usedApiTokens;
    return this.getResponseMetadata(apiContext, response).then((metadata) => {
      if (metadata) {
        const responseToCache = this.optionalStripResponse(apiContext, response);
        return this.cacheResponseAsync(apiContext, responseToCache); // callback will happen after caching
      } else {
        this.finish(apiContext);
        return this.finalizeResult(apiContext, response);
      }
    });
  }

  private async getCachedMetadata(apiContext: ApiContext): Promise<IIntelligentCacheMetadata> {
    if (apiContext.metadata || apiContext.etag) {
      return;
    }
    const redisKey = apiContext.redisKey.metadata;
    if (!redisKey) {
      throw new Error('No Redis key provided in apiContext.redisKey.metadata');
    }

    const cachedMetadata: IIntelligentCacheMetadata = await apiContext.libraryContext.redis.getObject(redisKey) as IIntelligentCacheMetadata;
    // TODO: BREAKPOINT: validate what the bare essentials of the cache might be here to help build out the real interface IIntelligentCacheMetadata
    this.recordRedisCost(apiContext, 'get', cachedMetadata);
    return cachedMetadata;
  }

  // end class after
}

// --- Caching integration with metadata/responses ---

function normalizedOptionsString(options) {
  if (!options) {
    return '';
  }
  let additional = null;
  if (options.additionalDifferentiationParameters) {
    additional = options.additionalDifferentiationParameters;
  }
  let opts = {...options, ...additional};
  if (opts.additionalDifferentiationParameters) {
    delete opts.additionalDifferentiationParameters;
  }
  const sortedkeys = _.keys(opts).sort();
  let normalized = [];
  sortedkeys.forEach((key) => {
    let value = opts[key];
    const typeOf = typeof (value);
    if (typeOf === 'undefined') {
      return;
    }
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
  if (flat && entity.headers) {
    flat.headers = entity.headers;
  }
  return flat;
}

export function flattenData(entity: any): any {
  if (!entity) {
    return entity;
  }
  if (entity.data !== undefined && !entity.data) {
    // If it's an empty string, or false, etc., return the value directly
    return entity.data;
  }
  const flat = projectFlatObjectWithData(entity);
  return flat;
}

export function createCallbackFlattenDataOptionally(callback) {
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

export function createCallbackFlattenData(callback) {
  return function callbackFlatEntityFromData(error, entity) {
    if (!error && entity && !entity.data) {
      error = new Error('No entity.data present in the result, cannot flatten the object');
    }
    if (!error) {
      try {
        const flat = projectFlatObjectWithData(entity);
        return callback(null, flat);
      } catch (flattenError) {
        error = flattenError;
      }
    }
    return callback(error);
  };
}

function sleepPromise(ms: number): Promise<void> {
  return new Promise<void>(resolve => {
    setTimeout(resolve, ms);
  });
}
