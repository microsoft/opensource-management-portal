//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import Debug from 'debug';
import { Octokit } from '@octokit/rest';
import { paginateGraphQL } from '@octokit/plugin-paginate-graphql';
import { retry } from '@octokit/plugin-retry';
import { RequestError } from '@octokit/request-error';
import type { TelemetryClient } from 'applicationinsights';

import * as restApi from './restApi.js';
import { flattenData } from './core.js';
import { CompositeIntelligentEngine } from './composite.js';
import { RestCollections } from './collections.js';
import { CrossOrganizationCollator } from './crossOrganization.js';
import { LinkMethods } from './links.js';
import { AppPurposeTypes, GitHubAppPurposes, ICustomAppPurpose } from './appPurposes.js';
import { CreateError } from '../transitional.js';
import { Operations } from '../../business/index.js';
import { requestLog } from './octokitRequestLog.js';
import type {
  GetAuthorizationHeader,
  AuthorizationHeaderValue,
  ICacheOptions,
  SiteConfiguration,
} from '../../interfaces/index.js';
import type { ICacheHelper } from '../caching/index.js';
import type {
  AdditionalRequirementsOptions,
  GitHubAuthenticationRequirement,
  GitHubAuthenticationWithRequirements,
  OctokitMethod,
} from './types.js';

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

type OctokitParameters = Record<string, string | number | boolean> | ICacheOptions;

const debug = Debug.debug('restapi');

const OurOpinionatedOctokit = Octokit.plugin(paginateGraphQL).plugin(retry);

// With the introduction of a breaking change in the underlying schema, any cache objects
// which are related to the GitHub library and have a SemVer equal to or less than this
// value will be discarded. The lack of a 'av' property (app version, originally) will
// also trigger a discard.
const breakingChangeGitHubPackageVersion = '6.0.0';

const shouldErrorShowRequest = false;

const ERROR_RESPONSE_HEADERS = [
  'x-github-request-id',
  'x-ratelimit-remaining',
  'x-ratelimit-resource',
  'x-ratelimit-used',
];

interface IRestLibraryOptions {
  insights: TelemetryClient;
  config: SiteConfiguration;
  cacheProvider: ICacheHelper;
  github?: Octokit;
  operations?: Operations;
  baseUrl?: string;
}

export class RestLibrary {
  public cacheProvider: ICacheHelper;
  private github: Octokit;

  private _collections: RestCollections;
  private _links: LinkMethods;
  private _crossOrganization: CrossOrganizationCollator;
  private githubEngine?: restApi.IntelligentGitHubEngine;
  private _insights?: TelemetryClient;

  defaultPageSize: number;

  public breakingChangeGitHubPackageVersion: string;
  public compositeEngine?: CompositeIntelligentEngine;

  constructor(options: IRestLibraryOptions) {
    const cacheProvider = options.cacheProvider;
    if (!cacheProvider) {
      throw new Error('No Redis instance provided to the GitHub library context constructor.');
    }
    this.cacheProvider = cacheProvider;
    this._insights = options.insights;
    const config = options.config;
    if (!config) {
      throw new Error('No runtime configuration instance provided to the library context constructor');
    }

    const restLibraryName = '@octokit/rest';
    const nodeGithubVersion = `${restLibraryName}/${Octokit.VERSION}`;
    let userAgent = nodeGithubVersion;
    if (config && config.github && config.github.library && config.github.library.userAgent) {
      userAgent = config.github.library.userAgent;
    }
    let github = options.github;
    if (!github) {
      const plugins = OurOpinionatedOctokit.plugins;
      for (let i = 0; i < plugins.length; ++i) {
        if (plugins[i].name === 'requestLog') {
          // replace with our own patched version to reduce debug output
          const newPlugin = requestLog;
          plugins[i] = newPlugin;
        }
      }
      github = new OurOpinionatedOctokit({
        userAgent,
        baseUrl: options.baseUrl,
        timeout: 2500, // ?
      });
    }
    this.github = github;

    this.defaultPageSize = config?.github?.api?.defaultPageSize || 100;
    this.breakingChangeGitHubPackageVersion = breakingChangeGitHubPackageVersion;

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

  get insights() {
    return this._insights;
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

  async callWithRequirements(
    requirements: GitHubAuthenticationWithRequirements,
    options: OctokitParameters,
    cacheOptions = null
  ) {
    if (!requirements?.requirements?.octokitFunctionName) {
      throw CreateError.InvalidParameters('No octokitFunctionName in requirements');
    }
    return this.call(
      requirements.authorization,
      requirements.requirements.octokitFunctionName,
      options,
      cacheOptions
    );
  }

  private async call(
    awaitToken: GetAuthorizationHeader | AuthorizationHeaderValue | string,
    api: string,
    options: any, // OctokitParameters,
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

  private request(
    token: GetAuthorizationHeader | string,
    restEndpoint: string,
    parameters: OctokitParameters,
    cacheOptions?: ICacheOptions
  ): Promise<any> {
    parameters = parameters || {};
    parameters['octokitRequest'] = restEndpoint;
    return this.call(token, 'request', parameters, cacheOptions);
  }

  async requestWithRequirements(
    requirements: GitHubAuthenticationWithRequirements,
    parameters: OctokitParameters,
    cacheOptions?: ICacheOptions
  ) {
    if (!requirements?.requirements?.octokitRequest) {
      throw CreateError.InvalidParameters('No octokitRequest in requirements');
    }
    return this.request(
      requirements.authorization,
      requirements.requirements.octokitRequest,
      parameters,
      cacheOptions
    );
  }

  requestAsPost(
    token: GetAuthorizationHeader | string,
    restEndpoint: string,
    parameters: OctokitParameters
  ): Promise<any> {
    parameters = parameters || {};
    parameters['octokitRequest'] = restEndpoint;
    return this.post(token, 'request', parameters);
  }

  async requestAsPostWithRequirements(
    requirements: GitHubAuthenticationWithRequirements,
    parameters: OctokitParameters
  ) {
    if (!requirements?.requirements?.octokitRequest) {
      throw CreateError.InvalidParameters('No octokitRequest in requirements');
    }
    return this.requestAsPost(
      requirements.authorization,
      requirements.requirements.octokitRequest,
      parameters
    );
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

  get octokit(): Octokit {
    return this.github;
  }

  createRequirementsForFunction(
    authorization: string | GetAuthorizationHeader,
    func: OctokitMethod<any>,
    funcAsString: string,
    options?: AdditionalRequirementsOptions
  ): GitHubAuthenticationWithRequirements {
    if (
      typeof authorization === 'string' &&
      GitHubAppPurposes.AllAvailableAppPurposes.includes(authorization as any as AppPurposeTypes)
    ) {
      throw CreateError.InvalidParameters(
        `The authorization must be a header or a function, not an AppPurpose of ${authorization}`
      );
    }
    const requirements: GitHubAuthenticationRequirement<any> = {
      octokitFunction: func,
      octokitFunctionName: funcAsString,
    };
    if (typeof authorization !== 'string') {
      authorization = authorization.bind(authorization, requirements);
    }
    if (options?.permissions) {
      requirements.permissions = options.permissions;
    }
    if (options?.permissionsMatchRequired !== undefined) {
      requirements.permissionsMatchRequired = options.permissionsMatchRequired;
    }
    if (options?.usePermissionsFromAlternateUrl) {
      requirements.usePermissionsFromAlternateUrl = options.usePermissionsFromAlternateUrl;
    }
    return { authorization, requirements };
  }

  createRequirementsForRequest(
    authorization: string | GetAuthorizationHeader,
    request: string,
    options?: AdditionalRequirementsOptions
  ): GitHubAuthenticationWithRequirements {
    if (
      typeof authorization === 'string' &&
      GitHubAppPurposes.AllAvailableAppPurposes.includes(authorization as any as AppPurposeTypes)
    ) {
      throw CreateError.InvalidParameters(
        `The authorization must be a header or a function, not an AppPurpose of ${authorization}`
      );
    }
    const firstSpace = request.indexOf(' ');
    if (!firstSpace) {
      throw CreateError.InvalidParameters('REST API request must begin with the HTTP method: ' + request);
    }
    const requirements: GitHubAuthenticationRequirement<any> = {
      octokitRequest: request,
    };
    if (options?.permissions) {
      requirements.permissions = options.permissions;
    }
    if (options?.usePermissionsFromAlternateUrl) {
      requirements.usePermissionsFromAlternateUrl = options.usePermissionsFromAlternateUrl;
    }
    if (options?.permissionsMatchRequired !== undefined) {
      requirements.permissionsMatchRequired = options.permissionsMatchRequired;
    }
    if (options?.allowBestFaithInstallationForAnyHttpMethod !== undefined) {
      requirements.allowBestFaithInstallationForAnyHttpMethod =
        options.allowBestFaithInstallationForAnyHttpMethod;
    }
    if (typeof authorization !== 'string') {
      authorization = authorization.bind(authorization, requirements);
    }
    return { authorization, requirements };
  }

  async postWithRequirements(requirements: GitHubAuthenticationWithRequirements, options: OctokitParameters) {
    if (!requirements?.requirements?.octokitFunctionName) {
      throw CreateError.InvalidParameters('No octokitFunctionName in requirements');
    }
    return this.post(requirements.authorization, requirements.requirements.octokitFunctionName, options);
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
    const now = new Date();
    let diagnosticHeaderInformation: AuthorizationHeaderValue = null;
    // prettier-ignore
    if (!options.headers.authorization) { // CodeQL [SM01513] basic validation of the presence of a header and not a security logic check
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
        if (debug?.enabled) {
          const optionsAsString = Object.getOwnPropertyNames(options)
            .map((key) => {
              const value = options[key];
              return `${key}=${value}`;
            })
            .join(', ');
          debug(`API ${api} POST ${endpoint} options: ${optionsAsString}`);
        }
        value = (await method.call(this.github, endpoint, options)) as Promise<any>;
      } else if (api.startsWith('graphql')) {
        debug(`API ${api} GraphQL POST`);
        massageData = noDataMassage;
        const query = options.octokitQuery;
        delete options.octokitQuery;
        const graphqlOptions = options.octokitGraphqlOptions as OctokitGraphqlOptions;
        delete options.octokitGraphqlOptions;
        const doNotAwait = graphqlOptions?.asIterator;
        if (graphqlOptions !== undefined) {
          diagnostic.octokitGraphqlOptions = graphqlOptions;
        }
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
        if (debug?.enabled) {
          const optionsAsString = Object.getOwnPropertyNames(options)
            .map((key) => {
              const value = options[key];
              return `${key}=${value}`;
            })
            .join(', ');
          debug(`API ${api} Generic POST options: ${optionsAsString}`);
        }
        diagnostic.options = options;
        value = (await method.call(this.github, options)) as Promise<any>;
      }
      const finalized = massageData(value);
      return finalized;
    } catch (error) {
      const asRequestError = error as RequestError;
      console.log(`\nDetailed GitHub API ${asRequestError?.request?.method || 'POST'} failure:`);
      const message = error?.message || error?.toString() || 'Unknown error message';
      const isUnicorn = message.includes('Unicorn!') && message.includes('<!DOCTYPE html>');
      console.log(isUnicorn ? '\tError: UNICORN' : `\tError: ${error.message}`);
      const isGraphqlError = error?.name === 'GraphqlResponseError';
      if (error?.message?.includes('Unexpected end of JSON input')) {
        console.log('Usually a unicorn and bad GitHub 500');
        console.dir(error);
      }
      if (asRequestError?.request?.body) {
        console.log();
        console.error('\tRequest body:');
        if (
          typeof asRequestError.request.body === 'string' ||
          typeof asRequestError.request.body === 'number'
        ) {
          console.log(`\t\t${asRequestError?.request?.body || 'unknown body'}`);
        } else if (typeof asRequestError.request.body === 'object') {
          console.log(`\t\t${JSON.stringify(asRequestError?.request?.body) || 'unknown body'}`);
        } else {
          console.log(`\t\tunknown body type: ${typeof asRequestError.request.body}`);
        }
      }
      if (error?.headers) {
        const headerKeys = Object.getOwnPropertyNames(error.headers);
        const hasNotableKeys = headerKeys.some((key) => ERROR_RESPONSE_HEADERS.includes(key));
        if (hasNotableKeys) {
          console.log();
          console.error('\tGitHub response headers:');
          for (const key of headerKeys) {
            if (ERROR_RESPONSE_HEADERS.includes(key)) {
              console.error(`\t\t${key}: ${error.headers[key]}`);
            }
          }
        }
      }
      if (isGraphqlError && error?.errors) {
        console.log();
        console.error('\tGraphQL errors:');
        for (let i = 0; i < error.errors.length; i++) {
          const err = error.errors[i];
          console.error(`\t\t${err.type}: ${err.message}`);
          if (err.path) {
            console.error(`\t\tPath: ${err.path.join(' > ')}`);
          }
          if (err.locations) {
            console.error(`\t\tLocations: ${err.locations.map((l) => `${l.line}:${l.column}`).join(', ')}`);
          }
        }
      }
      if (
        error?.message?.includes('Resource not accessible by integration') ||
        error?.message?.includes('Not Found') ||
        isGraphqlError
      ) {
        console.log();
        console.error('\tParameters:');
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
                console.log();
                console.log('\tHeaders:');
                for (let j = 0; j < headersKeys.length; j++) {
                  const headerKey = headersKeys[j];
                  const headerValue =
                    headerKey.toLocaleLowerCase() === 'authorization'
                      ? headers[headerKey].substring(0, 13) + '***'
                      : headers[headerKey];
                  console.log(`\t\t${headerKey}: ${headerValue}`);
                }
              } else if (Array.isArray(value)) {
                console.log(`\t\t${key}: [ ` + (value as unknown[]).join(', ') + ' ]');
              } else {
                console.log(`\t\t${key}: ${value}`);
              }
            }
          }
          const remainingKeys = Object.getOwnPropertyNames(diagnostic);
          if (remainingKeys.length > 0) {
            console.log();
            for (let i = 0; i < remainingKeys.length; i++) {
              let indent = '\t\t';
              const key = remainingKeys[i];
              let value = diagnostic[key];
              if (key === 'graphql' || key === 'query') {
                indent = '\t';
              }
              if (typeof value === 'string' && value?.includes && value.includes('\n')) {
                value = value
                  .split('\n')
                  .map((line: string) => `${indent}${line}`)
                  .join('\n');
              }
              console.log(`${indent}${key}: ${value}`);
            }
          }
        }
        if (diagnosticHeaderInformation) {
          console.error('\tAuthorization information:');
          const {
            installationId,
            organizationName,
            purpose,
            source,
            impliedTargetType,
            permissions,
            created,
            expires,
          } = diagnosticHeaderInformation;
          if (organizationName) {
            console.error(
              `\t\tHeader resolved for ${impliedTargetType || 'organization'}: ${organizationName}`
            );
          }
          if (installationId) {
            console.error(`\t\tInstallation ID: ${installationId}`);
          }
          const customPurpose = purpose as ICustomAppPurpose;
          if (purpose && customPurpose?.isCustomAppPurpose === true) {
            console.error(`\t\tCustom purpose: ${customPurpose.id}`);
          }
          if (purpose && !customPurpose?.isCustomAppPurpose) {
            console.error(`\t\tPurpose: ${purpose}`);
          }
          if (permissions) {
            console.error(`\t\tGranular permissions:`);
            const permissionKeys = Object.getOwnPropertyNames(permissions);
            for (let i = 0; i < permissionKeys.length; i++) {
              const permissionKey = permissionKeys[i];
              const permissionValue = permissions[permissionKey];
              console.error(`\t\t\t${permissionKey}: ${permissionValue}`);
            }
          }
          if (created || expires) {
            console.error(`\t\tRequest sent:  ${now.toISOString()}`);
            if (created && created > now) {
              console.error(`\t\tWarning: Token created in the future: ${created.toISOString()}`);
            } else if (expires && expires < now) {
              console.error(`\t\tWarning: Token expired in the past: ${expires.toISOString()}`);
            }
          }
          if (created) {
            console.error(`\t\tToken created: ${created.toISOString()}`);
          }
          if (expires) {
            console.error(`\t\tToken expires: ${expires.toISOString()}`);
          }
          if (source) {
            console.error(`\t\tSource: ${source}`);
          }
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
      if (isUnicorn) {
        throw CreateError.Wrap(`Received a GitHub unicorn HTTP ${error.status} response`, error);
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
