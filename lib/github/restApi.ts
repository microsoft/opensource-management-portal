//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

/*eslint no-console: ["error", { allow: ["log"] }] */

'use strict';

const _ = require('lodash');
const debug = require('debug')('oss-github');
import moment = require('moment');

const querystring = require('querystring');
const semver = require('semver');
const url = require('url');

import { IShouldServeCache, IntelligentEngine, ApiContext, IApiContextCacheValues, IApiContextRedisKeys, ApiContextType } from './core';

import appPackage = require('../../package.json');
import { ILibraryContext } from '.';
const appVersion = appPackage.version;

const longtermMetadataMinutes = 60 * 24 * 14; // assumed to be a long time
const longtermResponseMinutes = 60 * 24 * 7; // a week, sliding
const acceleratedExpirationMinutes = 10; // quick cleanup

interface IReducedGitHubMetadata {
  etag: string;
  av: string;
  link?: any;
  updated?: any;
}

interface IHackyOptions {
  t?: any;
}

interface IGitHubLink {
  link: string;
}

export class IntelligentGitHubEngine extends IntelligentEngine {

  public static findLibaryMethod(libraryInstance, apiName) {
    const instance = libraryInstance;
    const combined = apiName;

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

  // were previously in the pipeline and context:

  async callApi(apiContext: GitHubApiContext): Promise<any> {
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
    const response = await apiMethod.apply(thisArgument, args);
    return response;
  }

  processMetadataBeforeCall(apiContext, metadata) {
    if (metadata && metadata.av && apiContext.libraryContext.breakingChangeGitHubPackageVersion && !semver.gte(metadata.av, apiContext.libraryContext.breakingChangeGitHubPackageVersion)) {
      console.log(`${apiContext.redisKey.metadata} was using ${metadata.av}, which is < to ${apiContext.libraryContext.breakingChangeGitHubPackageVersion}. This is a schema break, discarding cache.`);
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

  withResponseUpdateMetadata(apiContext: ApiContext, response: any) {
    return response;
  }

  reduceMetadataToCacheFromResponse(apiContext: any, response: any): any {
    const headers = response ? response.headers : null;
    if (headers && headers.etag) {
      let reduced: IReducedGitHubMetadata = {
        etag: headers.etag,
        av: appVersion, // added in app v5.0.1
      };
      // console.log(`+ ${appVersion} storing app version to REST API caching metadata *NEW* ${apiContext.redisKey.metadata}`);
      if (headers.link) {
        reduced.link = headers.link;
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
    return headers;
  }

  withResponseShouldCacheBeServed(apiContext: ApiContext, response: any): boolean | IShouldServeCache {
    if (response === undefined) {
      throw new Error('The response was undefined and unable to process.');
    }
    if (!response.headers) {
      console.warn('As of Octokit 15.8.0, responses must have headers on the response');
      // return Q(false);
      throw new Error('no response.headers!!!!');
    }
    const headers = response.headers;
    let retryAfter = headers['retry-after'];
    if (retryAfter) {
      debug(`Retry-After header was present: ${retryAfter}`);
    }
    const rateLimitRemaining = headers['x-ratelimit-remaining'];
    if (rateLimitRemaining) {
      apiContext.cost.github.remainingApiTokens = rateLimitRemaining;
    }
    let statusCode = 0;
    if (headers.status) {
      let status = headers.status || '';
      let i = status.indexOf(' ');
      statusCode = parseInt(i >= 0 ? status.substr(0, i) : status);
      headers.statusActual = statusCode;
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
    return cacheOk;
  }

  getResponseMetadata(apiContext: ApiContext, response: any): Promise<any> {
    return Promise.resolve(response.headers);
  }

  withMetadataShouldCacheBeServed(apiContext: ApiContext, metadata: any): boolean | IShouldServeCache {
    // result can be falsy OR an object; { cache: true, refresh: true }
    // cache: whether to use the cache, if available
    // refresh: whether to refresh in the background for a newer value
    let shouldServeCache: IShouldServeCache | boolean = false;
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
          let secondsToAllowForRefresh = 2 + (apiContext.delayBeforeRefreshMilliseconds / 1000);
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
    return shouldServeCache;
  }

}

export function wrapCreatePage(libraryContext, github, kind) {
  return function(token, link, callback) {
    getPage(libraryContext, github, token, link, kind, callback);
  };
}

function getPage(libraryContext: ILibraryContext, github, token: string, link, which: string, callback) {
  const url = getPageLink(github, link, which);
  if (!url) {
    return callback(new Error('No GitHub collection link was present in the response.'));
  }
  const apiContext = prepareApiContextForGithub(createApiContextFromLink(github, url), github);
  apiContext.overrideToken(token);
  apiContext.libraryContext = libraryContext;

  const engine = libraryContext.githubEngine as IntelligentGitHubEngine;
  if (!engine) {
    return callback(new Error('No available GitHub engine'));
  }
  engine.execute(apiContext).then(ok => {
    return callback(null, ok);
  }, callback);
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

export class GitHubApiContext extends ApiContext {
  private _apiMethod: any;
  private _redisKeys: IApiContextRedisKeys;
  private _cacheValues: IApiContextCacheValues;
  private _token: string;

  public fakeLink?: IGitHubLink;

  public headers?: any;

  constructor(api: any, options: any) {
    super(api, options);

    const root = IntelligentEngine.redisKeyForApi(this.apiTypePrefix, api, options);
    this._redisKeys = {
      root: root,
      metadata: root ? root + IntelligentEngine.redisKeyAspectSuffix('headers') : IntelligentEngine.redisKeyForApi(this.apiTypePrefix, api, options, 'headers'),
    };

    this._cacheValues = {
      longtermMetadata: longtermMetadataMinutes,
      longtermResponse: longtermResponseMinutes,
      acceleratedExpiration: acceleratedExpirationMinutes,
    };
  }

  get token(): string {
    return this._token;
  }

  get apiMethod(): any {
    return this._apiMethod;
  }

  get apiTypePrefix(): string {
    return 'github#';
  }

  get redisKey(): IApiContextRedisKeys {
    return this._redisKeys;
  }

  get cacheValues(): IApiContextCacheValues {
    return this._cacheValues;
  }

  get contextType(): ApiContextType {
    return ApiContextType.GitHubRestApi;
  }

  attachToApiImplementation(implementationLibrary: any) {
    if (this._apiMethod) {
      // NOTE: this restriction was not in place in the original implementation
      // and is probably not needed
      throw new Error('API has already been attached to');
    }
    const method = IntelligentGitHubEngine.findLibaryMethod(implementationLibrary, this.api);
    method['thisInstance'] = implementationLibrary; // // HACK, is there a better way?
    this._apiMethod = method;
  }

  setLibraryContext(libraryContext: any) {
    this.libraryContext = libraryContext;
  }

  overrideToken(token: string) {
    this._token = token;
  }

  overrideApiMethod(method: any) {
    this._apiMethod = method;
  }
}

function prepareApiContextForGithub(apiContext: GitHubApiContext, github: any): GitHubApiContext {
  if (!apiContext.apiMethod) {
    apiContext.attachToApiImplementation(github);
  }
  return apiContext;
}

export function createFullContext(api: any, options: any, github: any, libraryContext: any): GitHubApiContext {
  const apiContext = prepareApiContextForGithub(createApiContextForGithub(api, options), github);
  apiContext.setLibraryContext(libraryContext);
  return apiContext;
}

function createApiContextForGithub(api: any, options: any): GitHubApiContext {
  const apiContext = new GitHubApiContext(api, options);
  return apiContext;
}

function createApiContextFromLink(github, linkAddress) {
  const api = 'getPage';
  const link = url.parse(linkAddress);
  const qs = querystring.parse(link.query);
  const pathArray = _.compact(link.pathname.split('/'));

  // Translate the path into key/value pairs
  const options: IHackyOptions = {};
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
  github.getNextPage.thisInstance = github; // hack! - single instance only works
  apiContext.overrideApiMethod(github.getNextPage);
  return apiContext;
}
