//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { Octokit } from '@octokit/rest';
import { paginateGraphql } from '@octokit/plugin-paginate-graphql';
import githubPackage from '@octokit/rest/package.json';

import * as restApi from './restApi';
import { flattenData } from './core';
import { CompositeIntelligentEngine } from './composite';
import { RestCollections } from './collections';
import { CrossOrganizationCollator } from './crossOrganization';
import { LinkMethods } from './links';
import { IGetAuthorizationHeader, IAuthorizationHeaderValue } from '../../interfaces';
import { ICacheHelper } from '../caching';
import { ICustomAppPurpose } from '../../business/githubApps';

export enum CacheMode {
  ValidateCache = 'ValidateCache',
  BackgroundRefresh = 'BackgroundRefresh',
}

export interface IGitHubPostFunction {
  (awaitToken: IGetAuthorizationHeader, api: string, parameters: any): Promise<any>;
}

export type OctokitGraphqlOptions = {
  paginate?: boolean;
  asIterator?: boolean;
};

const OurOpinionatedOctokit = Octokit.plugin(paginateGraphql);

// With the introduction of a breaking change in the underlying schema, any cache objects
// which are related to the GitHub library and have a SemVer equal to or less than this
// value will be discarded. The lack of a 'av' property (app version, originally) will
// also trigger a discard.
const breakingChangeGitHubPackageVersion = '6.0.0';

const shouldErrorShowRequest = false;

interface IRestLibraryOptions {
  config: any;
  cacheProvider: ICacheHelper;
  github?: Octokit;
  baseUrl?: string;
}

export class RestLibrary {
  public cacheProvider: ICacheHelper;
  private github: Octokit;

  private _collections: RestCollections;
  private _links: LinkMethods;
  private _crossOrganization: CrossOrganizationCollator;
  private githubEngine?: restApi.IntelligentGitHubEngine;

  defaultPageSize: number;

  public breakingChangeGitHubPackageVersion: string;
  public compositeEngine?: CompositeIntelligentEngine;

  constructor(options: IRestLibraryOptions) {
    const cacheProvider = options.cacheProvider;
    if (!cacheProvider) {
      throw new Error('No Redis instance provided to the GitHub library context constructor.');
    }
    this.cacheProvider = cacheProvider;

    const config = options.config;
    if (!config) {
      throw new Error('No runtime configuration instance provided to the library context constructor');
    }

    const nodeGithubVersion = `${githubPackage.name}/${githubPackage.version}`;
    let userAgent = nodeGithubVersion;
    if (config && config.github && config.github.library && config.github.library.userAgent) {
      userAgent = config.github.library.userAgent;
    }
    let github = options.github;
    if (!github) {
      github = new OurOpinionatedOctokit({
        userAgent,
        baseUrl: options.baseUrl,
      });
    }
    this.github = github;

    (this.defaultPageSize =
      config && config.github && config.github.api && config.github.api.defaultPageSize
        ? config.github.api.defaultPageSize
        : 100),
      (this.breakingChangeGitHubPackageVersion = breakingChangeGitHubPackageVersion);

    this.githubEngine = new restApi.IntelligentGitHubEngine();
    this.compositeEngine = new CompositeIntelligentEngine();

    this.hasNextPage = hasNextPage.bind(this);

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

  private async resolveAuthorizationHeader(
    authorizationHeader: IGetAuthorizationHeader | IAuthorizationHeaderValue | string
  ): Promise<string | IAuthorizationHeaderValue> {
    let authorizationValue = null;
    try {
      if (typeof authorizationHeader === 'string') {
        authorizationValue = authorizationHeader as string;
      } else if (typeof authorizationHeader === 'function') {
        let asFunc = authorizationHeader as IGetAuthorizationHeader;
        let resolved = asFunc.call(null) as Promise<IAuthorizationHeaderValue | string>;
        authorizationValue = await resolved;
        if (typeof resolved === 'function') {
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

  async call(
    awaitToken: IGetAuthorizationHeader | IAuthorizationHeaderValue | string,
    api: string,
    options,
    cacheOptions = null
  ): Promise<any> {
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

  requestAsPost(token, restEndpoint, parameters: any): Promise<any> {
    parameters = parameters || {};
    parameters['octokitRequest'] = restEndpoint;
    return this.post(token, 'request', parameters);
  }

  graphql<T = any>(
    token,
    query: string,
    parameters: any,
    graphqlOptions: OctokitGraphqlOptions = {}
  ): Promise<T> {
    return this.graphqlUntyped(token, query, parameters, graphqlOptions) as Promise<T>;
  }

  graphqlIteration<T = any>(
    token,
    query: string,
    parameters: any,
    graphqlOptions: OctokitGraphqlOptions = {}
  ): Promise<T> {
    graphqlOptions.asIterator = true;
    graphqlOptions.paginate = true;
    return this.graphqlUntyped(token, query, parameters, graphqlOptions) as Promise<T>;
  }

  private graphqlUntyped(
    token,
    query: string,
    parameters: any,
    graphqlOptions: OctokitGraphqlOptions = {}
  ): Promise<any> {
    let api = 'graphql';
    if (graphqlOptions?.paginate) {
      api = graphqlOptions?.asIterator ? 'graphql.paginate.iterator' : 'graphql.paginate';
    }
    parameters = parameters || {};
    parameters['octokitQuery'] = query;
    return this.post(token, api, parameters);
  }

  async post(awaitToken: IGetAuthorizationHeader | string, api: string, options: any): Promise<any> {
    const method = restApi.IntelligentGitHubEngine.findLibraryMethod(this.github, api);
    if (!options.headers) {
      options.headers = {};
    }
    const noDataMassage = (data) => data;
    let massageData = (data) => flattenData(data);
    if (options.allowEmptyResponse) {
      delete options.allowEmptyResponse;
      massageData = noDataMassage;
    }
    let diagnosticHeaderInformation: IAuthorizationHeaderValue = null;
    if (!options.headers.authorization) {
      const value = await this.resolveAuthorizationHeader(awaitToken);
      if ((value as IAuthorizationHeaderValue)?.purpose) {
        diagnosticHeaderInformation = value as IAuthorizationHeaderValue;
      }
      options.headers.authorization =
        typeof value === 'string' ? (value as string) : (value as IAuthorizationHeaderValue).value;
    }
    const diagnostic: Record<string, any> = {};
    try {
      let value = null;
      if (api === 'request' && options.octokitRequest) {
        const endpoint = options.octokitRequest;
        delete options.octokitRequest;
        diagnostic.octokitRequest = true;
        diagnostic.endpoint = endpoint;
        diagnostic.options = options;
        value = (await method.call(this.github, endpoint, options)) as Promise<any>;
      } else if (api.startsWith('graphql')) {
        massageData = noDataMassage;
        const query = options.octokitQuery;
        delete options.octokitQuery;
        const graphqlOptions = options.octokitGraphqlOptions as OctokitGraphqlOptions;
        delete options.octokitGraphqlOptions;
        const doNotAwait = graphqlOptions?.asIterator;
        diagnostic.octokitGraphqlOptions = graphqlOptions;
        diagnostic.graphql = true;
        diagnostic.query = query;
        diagnostic.options = options;
        if (doNotAwait) {
          const iterator = method.call(this.github, query, options) as Promise<any>;
          return iterator;
        } else {
          value = (await method.call(this.github, query, options)) as Promise<any>;
        }
      } else {
        diagnostic.options = options;
        value = (await method.call(this.github, options)) as Promise<any>;
      }
      const finalized = massageData(value);
      return finalized;
    } catch (error) {
      console.log(`API ${api} POST error: ${error.message}`);
      if (error?.message?.includes('Resource not accessible by integration')) {
        console.error('Options:');
        {
          const options =
            Object.getOwnPropertyNames(diagnostic.options).length > 0 ? diagnostic.options : null;
          delete diagnostic.options;
          if (options) {
            const optionsKeys = Object.getOwnPropertyNames(options);
            for (let i = 0; i < optionsKeys.length; i++) {
              const key = optionsKeys[i];
              const value = options[key];
              if (key === 'headers') {
                const headers = value as Record<string, string>;
                const headersKeys = Object.getOwnPropertyNames(headers);
                console.log('Headers:');
                for (let j = 0; j < headersKeys.length; j++) {
                  const headerKey = headersKeys[j];
                  const headerValue =
                    headerKey.toLocaleLowerCase() === 'authorization'
                      ? headers[headerKey].substring(0, 13) + '***'
                      : headers[headerKey];
                  console.log(`  - ${headerKey}: ${headerValue}`);
                }
              } else {
                console.log(`Option: ${key}: ${value}`);
              }
            }
          }
          const remainingKeys = Object.getOwnPropertyNames(diagnostic);
          if (remainingKeys.length > 0) {
            for (let i = 0; i < remainingKeys.length; i++) {
              const key = remainingKeys[i];
              const value = diagnostic[key];
              console.log(`${key}: ${value}`);
            }
          }
        }
        if (diagnosticHeaderInformation) {
          console.error('Authorization selection information:');
          const { installationId, organizationName, purpose, source } = diagnosticHeaderInformation;
          organizationName && console.error(`Header resolved for organization: ${organizationName}`);
          const customPurpose = purpose as ICustomAppPurpose;
          purpose &&
            customPurpose?.isCustomAppPurpose === true &&
            console.error(`Custom purpose: ${customPurpose.id}`);
          purpose && !customPurpose?.isCustomAppPurpose && console.error(`Purpose: ${purpose}`);
          installationId && console.error(`Installation ID: ${installationId}`);
          source && console.error(`Source: ${source}`);
        }
      }
      if (error.status) {
        console.log(`Status: ${error.status}`);
      }
      if (error?.response?.headers && error?.response?.headers['x-github-request-id']) {
        console.log(`Request ID: ${error.response.headers['x-github-request-id']}`);
      }
      if (error?.response?.headers && error?.response?.headers['x-ratelimit-remaining']) {
        console.log(`Rate limit remaining: ${error.response.headers['x-ratelimit-remaining']}`);
      }
      if (error?.response?.headers && error?.response?.headers['x-ratelimit-used']) {
        console.log(`Rate limit used: ${error.response.headers['x-ratelimit-used']}`);
      }
      if (shouldErrorShowRequest && error?.request) {
        console.dir(error.request);
      }
      throw error;
    }
  }
}

// follows: deprecated functions that parse links out of the response headers

function getPageLinks(link: any): any {
  link = link.link || link.headers.link || '';
  const links = {};
  // link format:
  // '<https://api.github.com/users/aseemk/followers?page=2>; rel="next", <https://api.github.com/users/aseemk/followers?page=2>; rel="last"'
  link.replace(/<([^>]*)>;\s*rel="([\w]*)"/g, (m, uri, type) => {
    links[type] = uri;
  });
  return links;
}

function hasNextPage(link): string {
  return getPageLinks(link).next;
}
