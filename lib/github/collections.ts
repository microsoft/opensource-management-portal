//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import _ from 'lodash';

import Debug from 'debug';
const debug = Debug.debug('restapi');

import cost from './cost.js';
import { RestResponse, flattenData } from './core.js';
import { CompositeApiContext, CompositeIntelligentEngine } from './composite.js';
import { RestLibrary } from './index.js';
import { sleep } from '../utils.js';
import GitHubApplication from '../../business/application.js';
import { CreateError, ErrorHelper } from '../transitional.js';

import type { GitHubAuthenticationWithRequirements } from './types.js';
import type { IPagedCacheOptions, GetAuthorizationHeader, IDictionary } from '../../interfaces/index.js';

export interface IGetAppInstallationsParameters {
  app_id: string;
}

type WithPage<T> = T & { page?: number };

type WithOctokitRequest<T> = T & { octokitRequest?: string };

export type CollectionCopilotSeatsOptions = {
  org: string;
  per_page?: number;
};

export enum GitHubPullRequestState {
  Open = 'open',
  Closed = 'closed',
  All = 'all',
}

export enum GitHubPullRequestSort {
  Created = 'created',
  Updated = 'updated',
  Popularity = 'popularity', // comment count
  LongRunning = 'long-running', // age, filtering by pulls updated in the last month
}

export enum GitHubSortDirection {
  Ascending = 'asc',
  Descending = 'desc',
}

export interface IListPullsParameters {
  owner: string;
  repo: string;
  state?: GitHubPullRequestState;
  head?: string;
  base?: string;
  sort?: GitHubPullRequestSort;
  direction?: GitHubSortDirection;
}

export const mostBasicAccountProperties = ['id', 'login', 'avatar_url'];

export const evenMoreBasicAccountProperties = ['id', 'login'];

const appInstallDetailsToCopy = GitHubApplication.PrimaryInstallationProperties;

export type SubReducerProperties = Record<string, string[]>;

export type WithSubPropertyReducer = any[] & { subPropertiesToReduce?: SubReducerProperties };

interface IRequestWithData {
  data: unknown;
  requests: IPageRequest[];
}

interface IPageRequest {
  cost: unknown;
  headers: IDictionary<string>;
  status?: number;
}

export class RestCollections {
  private libraryContext: RestLibrary;
  private githubCall: unknown;

  constructor(libraryContext: RestLibrary, githubCall: unknown) {
    this.libraryContext = libraryContext;
    this.githubCall = githubCall;
  }

  collectAllPages<ParametersType = any, EntityType = any>(
    token: string | GetAuthorizationHeader,
    collectionCacheKey: string,
    octokitApiName: string,
    parameters: ParametersType,
    cacheOptions: IPagedCacheOptions,
    fieldNamesToKeep?: string[] | WithSubPropertyReducer,
    arrayReducePropertyName?: string
  ): Promise<EntityType[]> {
    return this.generalizedCollectionWithFilter(
      collectionCacheKey,
      octokitApiName,
      fieldNamesToKeep,
      token,
      parameters,
      cacheOptions,
      arrayReducePropertyName
    );
  }

  collectAllPagesWithRequirements<ParametersType = any, EntityType = any>(
    collectionCacheKey: string,
    requirements: GitHubAuthenticationWithRequirements,
    parameters: ParametersType,
    cacheOptions: IPagedCacheOptions,
    fieldNamesToKeep?: string[] | WithSubPropertyReducer,
    arrayReducePropertyName?: string
  ): Promise<EntityType[]> {
    if (!requirements?.requirements?.octokitFunctionName) {
      throw CreateError.InvalidParameters('No octokitFunctionName in requirements');
    }
    return this.generalizedCollectionWithFilter(
      collectionCacheKey,
      requirements.requirements.octokitFunctionName,
      fieldNamesToKeep,
      requirements.authorization,
      parameters,
      cacheOptions,
      arrayReducePropertyName
    );
  }

  collectAllPagesViaHttpGet<ParametersType = any, EntityType = any>(
    token: string | GetAuthorizationHeader,
    collectionCacheKey: string,
    getRestUrl: string,
    parameters: ParametersType,
    cacheOptions: IPagedCacheOptions,
    fieldNamesToKeep?: string[] | WithSubPropertyReducer,
    arrayReducePropertyName?: string
  ): Promise<EntityType[]> {
    const expandedOptions: WithOctokitRequest<ParametersType> = Object.assign(
      {
        octokitRequest: getRestUrl.startsWith('GET ') ? getRestUrl.substr(4) : getRestUrl,
      },
      parameters
    );
    return this.collectAllPages<ParametersType, EntityType>(
      token,
      collectionCacheKey,
      'request',
      expandedOptions,
      cacheOptions,
      fieldNamesToKeep,
      arrayReducePropertyName
    );
  }

  collectAllPagesViaHttpGetWithRequirements<ParametersType = any, EntityType = any>(
    collectionCacheKey: string,
    requirements: GitHubAuthenticationWithRequirements,
    parameters: ParametersType,
    cacheOptions: IPagedCacheOptions,
    fieldNamesToKeep?: string[] | WithSubPropertyReducer,
    arrayReducePropertyName?: string
  ): Promise<EntityType[]> {
    if (!requirements?.requirements?.octokitRequest) {
      throw CreateError.InvalidParameters('No octokitRequest in requirements');
    }
    const getRestUrl = requirements.requirements.octokitRequest;
    const expandedOptions: WithOctokitRequest<ParametersType> = Object.assign(
      {
        octokitRequest: getRestUrl.startsWith('GET ') ? getRestUrl.substr(4) : getRestUrl,
      },
      parameters
    );
    return this.collectAllPages<ParametersType, EntityType>(
      requirements.authorization,
      collectionCacheKey,
      'request',
      expandedOptions,
      cacheOptions,
      fieldNamesToKeep,
      arrayReducePropertyName
    );
  }

  // ---

  getAppInstallations(
    token: string | GetAuthorizationHeader,
    parameters: IGetAppInstallationsParameters,
    cacheOptions: IPagedCacheOptions
  ): Promise<any> {
    if (!parameters.app_id) {
      throw new Error('parameters.app_id required');
    }
    const projectedOptions = {
      additionalDifferentiationParameters: parameters,
    };
    return this.generalizedCollectionWithFilter(
      `appInstallations`,
      'apps.listInstallations',
      appInstallDetailsToCopy,
      token,
      projectedOptions,
      cacheOptions
    );
  }

  private async getGithubCollection<OptionsType>(
    token: string | GetAuthorizationHeader,
    methodName: string,
    options: OptionsType,
    cacheOptions: IPagedCacheOptions,
    arrayReducePropertyName?: string
  ): Promise<IRequestWithData> {
    if ((options as any)?.page !== undefined) {
      throw CreateError.InvalidParameters(
        'The "page" option should not be passed to getGithubCollection as it manages pagination internally'
      );
    }
    const insights = this.libraryContext.insights;
    const hasNextPage = this.libraryContext.hasNextPage;
    const githubCall = this.githubCall;
    let done = false;
    let results = [];
    let recentResult = null;
    const requests = [];
    let emptyDataResponses = 0;
    let pages = 0;
    let currentPage = 1; // GitHub API uses 1-based pagination
    const pageLimit = (options as any)?.pageLimit || cacheOptions['pageLimit'] || Number.MAX_VALUE;
    const pageRequestDelay = cacheOptions.pageRequestDelay || null;
    while (!done) {
      const method = githubCall;
      const args = [];
      const currentToken = typeof token === 'string' ? token : await token();
      args.push(currentToken);
      const clonedOptions: WithPage<OptionsType> = Object.assign({}, options);
      clonedOptions.page = currentPage;
      const octokitRequest = (clonedOptions as any)?.octokitRequest as string;
      args.push(methodName, clonedOptions);
      let error = null;
      let result = null;
      try {
        result = await (method as any).apply(null, args);
        ++currentPage;
        if (
          arrayReducePropertyName &&
          result[arrayReducePropertyName] &&
          Array.isArray(result[arrayReducePropertyName])
        ) {
          const originalResultProperties = {
            headers: result?.headers,
            cost: result?.cost,
          };
          result = result[arrayReducePropertyName];
          result.headers = originalResultProperties.headers;
          result.cost = originalResultProperties.cost;
        }
        recentResult = result;
        if (result) {
          ++pages;
          if (Array.isArray(result)) {
            results = results.concat(result);
          }
          requests.push({
            cost: result.cost,
            headers: result.headers,
          });
        }
        try {
          done = pages >= pageLimit || !hasNextPage(result);
        } catch (nextPageError) {
          error = nextPageError;
          done = true;
        }
      } catch (iterationError) {
        if (
          iterationError?.message === 'no response.data' &&
          octokitRequest?.endsWith('/copilot/billing/seats') &&
          currentPage > 1
        ) {
          // The Copilot seat APIs occasionally return empty data temporarily. This is not
          // ideal, but it slows gathering. This telemetry will help monitor how common the
          // issue is.
          ++emptyDataResponses;
          insights?.trackEvent({
            name: 'github.rest.copilot.empty_seat_data',
            properties: {
              currentPage,
              octokitRequest,
              emptyDataResponses,
            },
          });
          if (emptyDataResponses < 5) {
            await sleep(500);
            continue;
          }
        }
        done = true;
        if (ErrorHelper.IsServerError(iterationError) && currentPage > 200) {
          // special unique error around calling copilot/billing/seats on the last page currently [2024-04-14]
          console.log('xxx hit issue on page ' + currentPage);
        } else {
          error = iterationError;
        }
      }
      if (!done && !error && result.headers && result.headers['retry-after']) {
        // actual retry headers win
        const delaySeconds = result.headers['retry-after'];
        debug(`Retry-After header was present. Delaying before next page ${delaySeconds}s.`);
        await sleep(delaySeconds * 1000);
      } else if (pageRequestDelay) {
        const to = typeof pageRequestDelay;
        let evaluatedTime = 0;
        if (to === 'number') {
          evaluatedTime = pageRequestDelay as number;
        } else if (to === 'function') {
          evaluatedTime = (pageRequestDelay as unknown as any)();
        } else {
          throw new Error(`Unsupported pageRequestDelay type: ${to}`);
        }
        await sleep(evaluatedTime);
      }
      if (error) {
        throw error;
      }
    }
    const data = {
      data: results,
    };
    return { data, requests };
  }

  private async getFilteredGithubCollection<DataType, OptionsType>(
    token: string | GetAuthorizationHeader,
    methodName: string,
    options: OptionsType,
    cacheOptions: IPagedCacheOptions,
    propertiesToKeep: string[],
    arrayReducePropertyName?: string
  ): Promise<IRequestWithData> {
    const keepAll = !propertiesToKeep;
    const subReductionProperties =
      propertiesToKeep && (propertiesToKeep as WithSubPropertyReducer).subPropertiesToReduce;
    try {
      // IRequestWithData
      const getCollectionResponse = await this.getGithubCollection(
        token,
        methodName,
        options,
        cacheOptions,
        arrayReducePropertyName
      );
      if (!getCollectionResponse) {
        throw new Error('No response');
      }
      const root = getCollectionResponse.data as any;
      if (!root) {
        throw new Error('No object, no data');
      }
      if (!root.data) {
        throw new Error('The resulting object did not contain a data property');
      }
      const requests = getCollectionResponse.requests;
      const results = root.data;
      const repos = [];
      for (let i = 0; i < results.length; i++) {
        const doNotModify = results[i];
        if (doNotModify) {
          const r = {};
          try {
            _.forOwn(doNotModify, (value, key) => {
              if (keepAll || propertiesToKeep.indexOf(key) >= 0) {
                if (subReductionProperties && subReductionProperties[key] && value) {
                  const validSubKeys = new Set(subReductionProperties[key]);
                  for (const subKey of Object.getOwnPropertyNames(value)) {
                    if (!validSubKeys.has(subKey)) {
                      delete value[subKey];
                    }
                  }
                } else if (subReductionProperties && subReductionProperties[key] && !value) {
                  console.warn(
                    `GitHub Collections reduction warning: no properties for ${key} in ${JSON.stringify(value)}`
                  );
                }
                r[key] = value;
              }
            });
            repos.push(r);
          } catch (error) {
            console.warn(`GitHub Collections warning: Error processing object clone`, error);
          }
        }
      }
      const filteredData = {
        data: repos,
      };
      return {
        data: filteredData,
        requests,
      };
    } catch (error) {
      throw error;
    }
  }

  private async getFilteredGithubCollectionWithMetadataAnalysis<DataType, OptionsType>(
    token: string | GetAuthorizationHeader,
    methodName: string,
    options: OptionsType,
    cacheOptions: IPagedCacheOptions,
    propertiesToKeep: string[],
    arrayReducePropertyName?: string
  ): Promise<RestResponse> {
    const collectionResults = await this.getFilteredGithubCollection<DataType, OptionsType>(
      token,
      methodName,
      options,
      cacheOptions,
      propertiesToKeep,
      arrayReducePropertyName
    );
    const results = collectionResults.data as RestResponse;
    const requests = collectionResults.requests;
    const pages = [];
    let dirty = false;
    const dirtyModified = [];
    const compositeCost = cost.create();
    for (let i = 0; i < requests.length; i++) {
      if (requests[i] && requests[i].headers && requests[i].headers.etag) {
        pages.push(requests[i].headers.etag);
      } else {
        throw new Error('Invalid set of responses for pages');
      }
      if (requests[i] && requests[i].status && requests[i].status !== 304) {
        dirty = true;
        const lastModified = requests[i].headers['last-modified'];
        if (lastModified) {
          dirtyModified.push(lastModified);
        }
      }
      if (requests[i] && requests[i].cost) {
        cost.add(compositeCost, requests[i].cost);
      }
    }
    if (dirtyModified.length > 0) {
      debug('Last-Modified response was present. This work is not yet implemented.');
      // Some types, typically direct entities, will return this value; collections do not.
      // Would want to use the Last-Modified over the refresh time, sorting to find the latest.
    }
    results.headers = {
      pages,
      dirty,
    };
    results.cost = compositeCost;
    return results;
  }

  private generalizedCollectionMethod(
    token: string | GetAuthorizationHeader,
    apiName: string,
    method,
    options,
    cacheOptions: IPagedCacheOptions
  ): Promise<RestResponse> {
    const apiContext = new CompositeApiContext(apiName, method, options);
    apiContext.maxAgeSeconds = cacheOptions.maxAgeSeconds || 600;
    apiContext.overrideToken(token);
    apiContext.libraryContext = this.libraryContext;
    if (cacheOptions.backgroundRefresh) {
      apiContext.backgroundRefresh = true;
    }
    const compositeEngine = this.libraryContext.compositeEngine as CompositeIntelligentEngine;
    return compositeEngine.execute(apiContext);
  }

  private getCollectionAndFilter<DataType, OptionsType>(
    token: string | GetAuthorizationHeader,
    options: OptionsType,
    cacheOptions: IPagedCacheOptions,
    githubClientMethod: string,
    propertiesToKeep: string[],
    arrayReducePropertyName?: string
  ) {
    const capturedThis = this;
    return function (token: string | GetAuthorizationHeader, options: OptionsType) {
      return capturedThis.getFilteredGithubCollectionWithMetadataAnalysis<DataType, OptionsType>(
        token,
        githubClientMethod,
        options,
        cacheOptions,
        propertiesToKeep,
        arrayReducePropertyName
      );
    };
  }

  private async generalizedCollectionWithFilter<DataType, OptionsType>(
    name: string,
    githubClientMethod: string,
    propertiesToKeep: string[],
    token: string | GetAuthorizationHeader,
    options: OptionsType,
    cacheOptions: IPagedCacheOptions,
    arrayReducePropertyName?: string
  ): Promise<DataType> {
    const rows = await this.generalizedCollectionMethod(
      token,
      name,
      this.getCollectionAndFilter(
        token,
        options,
        cacheOptions,
        githubClientMethod,
        propertiesToKeep,
        arrayReducePropertyName
      ),
      options,
      cacheOptions
    );
    const flattened = flattenData(rows);
    return flattened;
  }
}
