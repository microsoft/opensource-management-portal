//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

const GitHubApi = require('@octokit/rest');
const githubPackage = require('@octokit/rest/package.json');

import * as restApi from './restApi';
import { createCallbackFlattenData, createCallbackFlattenDataOptionally } from './core';
import { CompositeIntelligentEngine } from './composite';
import { RestCollections } from './collections';
import { CrossOrganizationCollator } from './crossOrganization';
import { ILinkProvider } from '../linkProviders/postgres/postgresLinkProvider';
import { LinkMethods } from './links';

export enum CacheMode {
  ValidateCache = 'ValidateCache',
  BackgroundRefresh = 'BackgroundRefresh',
}

export interface ILibraryContext {
  redis?: any;
  insights?: any;
  linkProvider: ILinkProvider;
  memoryCache?: any;
  breakingChangeGitHubPackageVersion?: any;

  hasNextPage?: (any) => boolean;

  // getNextPage?: any;
  // getNextPageExtended?: any;

  call?: any;
  request?: any;
  post?: any;

  collections?: RestCollections;
  links?: LinkMethods;
  crossOrganization?: CrossOrganizationCollator;

  githubEngine?: restApi.IntelligentGitHubEngine;
  compositeEngine?: CompositeIntelligentEngine;

  defaultPageSize: number;
}

// With the introduction of a breaking change in the underlying schema, any cache objects
// which are related to the GitHub library and have a SemVer equal to or less than this
// value will be discarded. The lack of a 'av' property (app version, originally) will
// also trigger a discard.
const breakingChangeGitHubPackageVersion = '6.0.0';

export function CreateRestLibraryContext(options): ILibraryContext {
  const redis = options.redis;
  if (!redis) {
    throw new Error('No Redis instance provided to the GitHub library context constructor.');
  }

  const linkProvider = options.linkProvider as ILinkProvider;
  if (!linkProvider) {
    throw new Error('No link provider included in the options to the library context constructor');
  }

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

  const libraryContext: ILibraryContext = {
    redis,
    insights: options.insights,
    memoryCache,
    linkProvider,
    defaultPageSize: config && config.github && config.github.api && config.github.api.defaultPageSize ? config.github.api.defaultPageSize : 100,

    breakingChangeGitHubPackageVersion: breakingChangeGitHubPackageVersion,
  };

  libraryContext.githubEngine = new restApi.IntelligentGitHubEngine();
  libraryContext.compositeEngine = new CompositeIntelligentEngine();

  libraryContext.hasNextPage = hasNextPage.bind(libraryContext);

  // libraryContext.getNextPage = restApi.wrapCreateNextPage(libraryContext, github);
  // libraryContext.getNextPageExtended = restApi.wrapCreateNextPage(libraryContext, github, true);

  libraryContext.call = function callGithub(token, api, options, cacheOptions, callback) {
    if (!callback && typeof(cacheOptions) === 'function') {
      callback = cacheOptions;
      cacheOptions = null;
    }
    cacheOptions = cacheOptions || {};

    let innerCallback = createCallbackFlattenData(callback);
    if (options.allowEmptyResponse) {
      delete options.allowEmptyResponse;
      innerCallback = callback;
    }

    const apiContext = restApi.createFullContext(api, options, github, libraryContext);
    apiContext.overrideToken(token);

    if (cacheOptions.maxAgeSeconds) {
      apiContext.maxAgeSeconds = cacheOptions.maxAgeSeconds;
    }
    if (cacheOptions.backgroundRefresh !== undefined) {
      apiContext.backgroundRefresh = cacheOptions.backgroundRefresh;
    }
    return libraryContext.githubEngine.execute(apiContext).then(result => {
      return innerCallback(null, result);
    }, innerCallback as (err: any) => any);
  };

  libraryContext.request = function callOctokitRequest(token, restEndpoint, parameters: any, cacheOptions, callback) {
    parameters = parameters || {};
    parameters['octokitRequest'] = restEndpoint;
    return libraryContext.call(token, 'request', parameters, cacheOptions, callback);
  };

  // Post is a direct wrap around the GitHub library. It does not
  libraryContext.post = function callGitHubNoCache(token, api, options, callback) {
    const method = restApi.IntelligentGitHubEngine.findLibaryMethod(github, api);
    if (!options.headers) {
      options.headers = {};
    }
    if (!options.headers.Authorization) {
      options.headers.Authorization = `token ${token}`;
    }
    try {
      const legacyCallback = createCallbackFlattenDataOptionally(callback);
      const promiseBack = method.call(github, options) as Promise<any>;
      promiseBack.then(value => {
        return legacyCallback(null, value);
      }).catch(error => {
        return legacyCallback(error, null);
      });
    } catch (missingOrMajorError) {
      return callback(missingOrMajorError);
    }
  };

  libraryContext.collections = new RestCollections(libraryContext, libraryContext.call);

  libraryContext.links = new LinkMethods(libraryContext);

  libraryContext.crossOrganization = new CrossOrganizationCollator(libraryContext, libraryContext.collections);

  return libraryContext;
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
