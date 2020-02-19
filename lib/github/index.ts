//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

const GitHubApi = require('@octokit/rest');
const githubPackage = require('@octokit/rest/package.json');

import * as restApi from './restApi';
import { flattenData } from './core';
import { CompositeIntelligentEngine } from './composite';
import { RestCollections } from './collections';
import { CrossOrganizationCollator } from './crossOrganization';
import { ILinkProvider } from '../linkProviders/postgres/postgresLinkProvider';
import { LinkMethods } from './links';
import { RedisHelper } from '../redis';
import { IGetAuthorizationHeader, IAuthorizationHeaderValue } from '../../transitional';

export enum CacheMode {
  ValidateCache = 'ValidateCache',
  BackgroundRefresh = 'BackgroundRefresh',
}

export interface IGitHubPostFunction {
  (awaitToken: IGetAuthorizationHeader, api: string, parameters: any): Promise<any>;
}

// With the introduction of a breaking change in the underlying schema, any cache objects
// which are related to the GitHub library and have a SemVer equal to or less than this
// value will be discarded. The lack of a 'av' property (app version, originally) will
// also trigger a discard.
const breakingChangeGitHubPackageVersion = '6.0.0';

export class RestLibrary {
  public redis: RedisHelper; // TODO: confirm RedisClient is correct
  private insights?: any;
  private linkProvider: ILinkProvider;
  private github: any;

  public memoryCache?: any;
  private _collections: RestCollections;
  private _links: LinkMethods;
  private _crossOrganization: CrossOrganizationCollator;
  private githubEngine?: restApi.IntelligentGitHubEngine;

  defaultPageSize: number;

  public breakingChangeGitHubPackageVersion: string;
  public compositeEngine?: CompositeIntelligentEngine;

  constructor(options) {
    const redis = options.redis;
    if (!redis) {
      throw new Error('No Redis instance provided to the GitHub library context constructor.');
    }
    this.redis = redis;

    const linkProvider = options.linkProvider as ILinkProvider;
    if (!linkProvider) {
      throw new Error('No link provider included in the options to the library context constructor');
    }
    this.linkProvider = linkProvider;

    let config = options.config;
    if (!config) {
      throw new Error('No runtime configuration instance provided to the library context constructor');
    }

    let memoryCache = options.memoryCache || new Map();

    const nodeGithubVersion = `${githubPackage.name}/${githubPackage.version}`;
    let userAgent = nodeGithubVersion;
    if (config && config.github && config.github.library && config.github.library.userAgent) {
      userAgent = config.github.library.userAgent;
    }
    let github = options.github;
    if (!github) {
      let githubApi = options.GitHubApi || GitHubApi;
      github = new githubApi({
        userAgent,
      });
    }
    this.github = github;

    this.defaultPageSize = config && config.github && config.github.api && config.github.api.defaultPageSize ? config.github.api.defaultPageSize : 100,
    this.breakingChangeGitHubPackageVersion = breakingChangeGitHubPackageVersion;

    this.githubEngine = new restApi.IntelligentGitHubEngine();
    this.compositeEngine = new CompositeIntelligentEngine();

    this.hasNextPage = hasNextPage.bind(this);

    this.memoryCache = memoryCache;

    this.call = this.call.bind(this);
    this.post = this.post.bind(this);
    this.request = this.request.bind(this);
  }

  get collections(): RestCollections {
    if (!this._collections) {
      this._collections = new RestCollections(this, this.call);
    }
    return this._collections;
  }

  get links(): LinkMethods {
    if (!this._links) {
      this._links = new LinkMethods(this);
    }
    return this._links;
  }

  get crossOrganization(): CrossOrganizationCollator {
    if (!this._crossOrganization) {
      this._crossOrganization = new CrossOrganizationCollator(this, this.collections);
    }
    return this._crossOrganization;
  }

  hasNextPage?: (any) => boolean;

  private async resolveAuthorizationHeader(authorizationHeader: IGetAuthorizationHeader | IAuthorizationHeaderValue | string): Promise<string | IAuthorizationHeaderValue> {
    let authorizationValue = null;
    try {
      if (typeof(authorizationHeader) === 'string') {
        authorizationValue = authorizationHeader as string;
      } else if (typeof(authorizationHeader) === 'function') {
        let asFunc = authorizationHeader as IGetAuthorizationHeader;
        let resolved = asFunc.call(null) as Promise<IAuthorizationHeaderValue | string>;
        authorizationValue = await resolved;
        if (typeof(resolved) === 'function') {
          asFunc = resolved as IGetAuthorizationHeader;
          resolved = asFunc.call(null) as Promise<IAuthorizationHeaderValue | string>;
          authorizationValue = await resolved;
        }
      } else if (authorizationHeader && authorizationHeader['value']) {
        authorizationValue = authorizationHeader as IAuthorizationHeaderValue;
      } else {
        throw new Error('Invalid resolveAuthorizationHeader');
      }
    } catch (getTokenError) {
      console.dir(getTokenError);
      throw getTokenError;
    }
    return authorizationValue;
  }

  async call(awaitToken: IGetAuthorizationHeader | IAuthorizationHeaderValue | string, api: string, options, cacheOptions = null): Promise<any> {
    cacheOptions = cacheOptions || {};
    let massageData = (data) => flattenData(data);
    if (options.allowEmptyResponse) {
      delete options.allowEmptyResponse;
      massageData = (data) => data;
    }
    const apiContext = restApi.createFullContext(api, options, this.github, this);
    // CONSIDER: technically, callApi can wait to resolve the token by passing it into the context as-is
    apiContext.overrideToken(await this.resolveAuthorizationHeader(awaitToken));
    if (cacheOptions.maxAgeSeconds) {
      apiContext.maxAgeSeconds = cacheOptions.maxAgeSeconds;
    }
    if (cacheOptions.backgroundRefresh !== undefined) {
      apiContext.backgroundRefresh = cacheOptions.backgroundRefresh;
    }
    const data = await this.githubEngine.execute(apiContext);
    const result = massageData(data);
    return result;
  }

  request(token, restEndpoint, parameters: any, cacheOptions): Promise<any> {
    parameters = parameters || {};
    parameters['octokitRequest'] = restEndpoint;
    return this.call(token, 'request', parameters, cacheOptions);
  }

  async post(awaitToken: IGetAuthorizationHeader | string, api: string, options: any): Promise<any> {
    const method = restApi.IntelligentGitHubEngine.findLibaryMethod(this.github, api);
    if (!options.headers) {
      options.headers = {};
    }
    let massageData = (data) => flattenData(data);
    if (options.allowEmptyResponse) {
      delete options.allowEmptyResponse;
      massageData = (data) => data;
    }
    if (!options.headers.authorization) {
      const value = await this.resolveAuthorizationHeader(awaitToken);
      options.headers.authorization = typeof(value) === 'string' ? value as string : (value as IAuthorizationHeaderValue).value;
    }
    try {
      const value = await method.call(this.github, options) as Promise<any>;
      const finalized = massageData(value);
      return finalized;
    } catch (error) {
      console.log(error.message);
      if (error.status) {
        console.log(`Status: ${error.status}`);
      }
      if (error.headers && error.headers['x-ratelimit-remaining']) {
        console.log(`Rate limit remaining: ${error.headers['x-ratelimit-remaining']}`);
      }
      if (error.request) {
        console.dir(error.request);
      }
      throw error;
    }
  }
}

// follows: deprecated functions that parse links out of the response headers

function getPageLinks (link: any): any {
  link = link.link || link.headers.link || '';
  const links = {};
  // link format:
  // '<https://api.github.com/users/aseemk/followers?page=2>; rel="next", <https://api.github.com/users/aseemk/followers?page=2>; rel="last"'
  link.replace(/<([^>]*)>;\s*rel="([\w]*)"/g, (m, uri, type) => {
    links[type] = uri
  });
  return links;
}

function hasNextPage (link): string {
  return getPageLinks(link).next;
}
