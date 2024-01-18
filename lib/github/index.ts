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
import { GetAuthorizationHeader, AuthorizationHeaderValue } from '../../interfaces';
import { ICacheHelper } from '../caching';
import { ICustomAppPurpose } from './appPurposes';
import { CreateError } from '../transitional';

export enum CacheMode {
  ValidateCache = 'ValidateCache',
  BackgroundRefresh = 'BackgroundRefresh',
}

export enum HttpMethod {
  Get = 'GET',
  Post = 'POST',
  Put = 'PUT',
  Patch = 'PATCH',
  Delete = 'DELETE',
}

export interface IGitHubPostFunction {
  (awaitToken: GetAuthorizationHeader, api: string, parameters: any): Promise<any>;
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
    authorizationHeader: GetAuthorizationHeader | AuthorizationHeaderValue | string
  ): Promise<string | AuthorizationHeaderValue> {
    let authorizationValue = null;
    try {
      if (!authorizationHeader) {
        throw CreateError.InvalidParameters('No authorization header');
      } else if (typeof authorizationHeader === 'string') {
        authorizationValue = authorizationHeader as string;
      } else if (typeof authorizationHeader === 'function') {
        let asFunc = authorizationHeader as GetAuthorizationHeader;
        let resolved = asFunc.call(null) as Promise<AuthorizationHeaderValue | string>;
        authorizationValue = await resolved;
        if (typeof resolved === 'function') {
          asFunc = resolved as GetAuthorizationHeader;
          resolved = asFunc.call(null) as Promise<AuthorizationHeaderValue | string>;
          authorizationValue = await resolved;
        }
      } else if (authorizationHeader && authorizationHeader['value']) {
        authorizationValue = authorizationHeader as AuthorizationHeaderValue;
      } else {
        throw CreateError.InvalidParameters('Unknown resolveAuthorizationHeader type');
      }
    } catch (getTokenError) {
      console.dir(getTokenError);
      throw getTokenError;
    }
    return authorizationValue;
  }

  async call(
    awaitToken: GetAuthorizationHeader | AuthorizationHeaderValue | string,
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

  request(token: GetAuthorizationHeader | string, restEndpoint, parameters: any, cacheOptions): Promise<any> {
    parameters = parameters || {};
    parameters['octokitRequest'] = restEndpoint;
    return this.call(token, 'request', parameters, cacheOptions);
  }

  requestAsPost(token: GetAuthorizationHeader | string, restEndpoint, parameters: any): Promise<any> {
    parameters = parameters || {};
    parameters['octokitRequest'] = restEndpoint;
    return this.post(token, 'request', parameters);
  }

  restApi(
    token: GetAuthorizationHeader | string,
    httpMethod: HttpMethod,
    restEndpoint: string,
    parameters: any
  ): Promise<any> {
    const requestUrlValue = `${httpMethod} ${restEndpoint}`;
    return httpMethod === HttpMethod.Get
      ? this.request(token, requestUrlValue, parameters, {})
      : this.requestAsPost(token, requestUrlValue, parameters);
  }

  graphql<T = any>(
    token: GetAuthorizationHeader | string,
    query: string,
    parameters: any,
    graphqlOptions: OctokitGraphqlOptions = {}
  ): Promise<T> {
    return this.graphqlUntyped(token, query, parameters, graphqlOptions) as Promise<T>;
  }

  graphqlIteration<T = any>(
    token: GetAuthorizationHeader | string,
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

  async post(awaitToken: GetAuthorizationHeader | string, api: string, options: any): Promise<any> {
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
    let diagnosticHeaderInformation: AuthorizationHeaderValue = null;
    if (!options.headers.authorization) {
      const value = await this.resolveAuthorizationHeader(awaitToken);
      if ((value as AuthorizationHeaderValue)?.purpose) {
        diagnosticHeaderInformation = value as AuthorizationHeaderValue;
      }
      options.headers.authorization =
        typeof value === 'string' ? (value as string) : (value as AuthorizationHeaderValue).value;
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
      if (error?.message?.includes('Unexpected end of JSON input')) {
        console.log('Usually a unicorn and bad GitHub 500');
        console.dir(error);
      }
      if (
        error?.message?.includes('Resource not accessible by integration') ||
        error?.message?.includes('Not Found')
      ) {
        console.error('\tOptions:');
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
                console.log('\t\tHeaders:');
                for (let j = 0; j < headersKeys.length; j++) {
                  const headerKey = headersKeys[j];
                  const headerValue =
                    headerKey.toLocaleLowerCase() === 'authorization'
                      ? headers[headerKey].substring(0, 13) + '***'
                      : headers[headerKey];
                  console.log(`\t\t  - ${headerKey}: ${headerValue}`);
                }
              } else {
                console.log(`\t\tOption: ${key}: ${value}`);
              }
            }
          }
          const remainingKeys = Object.getOwnPropertyNames(diagnostic);
          if (remainingKeys.length > 0) {
            for (let i = 0; i < remainingKeys.length; i++) {
              const key = remainingKeys[i];
              const value = diagnostic[key];
              console.log(`\t\t${key}: ${value}`);
            }
          }
        }
        if (diagnosticHeaderInformation) {
          console.error('\tAuthorization selection information:');
          const { installationId, organizationName, purpose, source } = diagnosticHeaderInformation;
          organizationName && console.error(`\t\tHeader resolved for organization: ${organizationName}`);
          const customPurpose = purpose as ICustomAppPurpose;
          purpose &&
            customPurpose?.isCustomAppPurpose === true &&
            console.error(`\t\tCustom purpose: ${customPurpose.id}`);
          purpose && !customPurpose?.isCustomAppPurpose && console.error(`\t\tPurpose: ${purpose}`);
          installationId && console.error(`\t\tInstallation ID: ${installationId}`);
          source && console.error(`\t\tSource: ${source}`);
        }
      }
      if (error.status) {
        console.log(`\tStatus: ${error.status}`);
      }
      if (error?.response?.headers && error?.response?.headers['x-github-request-id']) {
        console.log(`\tRequest ID: ${error.response.headers['x-github-request-id']}`);
      }
      if (error?.response?.headers && error?.response?.headers['x-ratelimit-remaining']) {
        console.log(`\tRate limit remaining: ${error.response.headers['x-ratelimit-remaining']}`);
      }
      if (error?.response?.headers && error?.response?.headers['x-ratelimit-used']) {
        console.log(`\tRate limit used: ${error.response.headers['x-ratelimit-used']}`);
      }
      if (shouldErrorShowRequest && error?.request) {
        console.dir(error.request);
      }
      console.log();
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
