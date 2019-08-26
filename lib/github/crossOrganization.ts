//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

/*eslint no-console: ["error", { allow: ["warn"] }] */

'use strict';

import async = require('async');
import Q from 'q';
import { IIntelligentCacheObjectResponse, IIntelligentCacheResponseArray, createCallbackFlattenData } from './core';
import { CompositeApiContext } from './composite';
import { ILibraryContext } from '.';

interface IOrganizationsResponse extends IIntelligentCacheObjectResponse {
  orgs?: any;
}

interface ICrossOrganizationDataResponse extends IIntelligentCacheObjectResponse {
  data?: any;
}

interface ILocalOptionsParameters {
  per_page: number;
  id?: string;
  team_id?: string;
  owner?: string;
  repo?: string;
}

export class CrossOrganizationCollator {
  private libraryContext: ILibraryContext;
  private collectionsClient: any;

  constructor(libraryContext: ILibraryContext, collectionsClient: any) {
    this.libraryContext = libraryContext;
    this.collectionsClient = collectionsClient;
  }

  orgMembers(orgsAndTokens, options, cacheOptions, callback) {
    options.apiTypePrefix = 'github.x#';
    return this.getCrossOrganizationMethod(
      orgsAndTokens,
      'orgMembers',
      'getOrgMembers',
      options,
      cacheOptions,
      createCallbackFlattenData(callback));
  }

  teams(orgsAndTokens, options, cacheOptions, callback) {
    if (!this) {
      console.log('1');
    }
    return this.getAllTeams(orgsAndTokens, options, cacheOptions, createCallbackFlattenData(callback));
  }

  teamMembers(orgsAndTokens, options, cacheOptions, callback) {
    options.apiTypePrefix = 'github.x#';
    const capturedThis = this;
    return this.generalizedCollectionMethod(
      orgsAndTokens,
      'teamMembers',
      capturedThis.crossOrganizationCollection(
        capturedThis,
        orgsAndTokens,
        options,
        cacheOptions,
        'team',
        capturedThis.getAllTeams,
        'getTeamMembers',
        'members',
        true),
    options,
    cacheOptions,
    createCallbackFlattenData(callback));
  }

  repos(orgsAndTokens, options, cacheOptions, callback) {
    return this.getAllRepos(orgsAndTokens, options, cacheOptions, createCallbackFlattenData(callback));
  }

  repoCollaborators(orgsAndTokens, options, cacheOptions, callback) {
    options.apiTypePrefix = 'github.x#';
    const capturedThis =  this;
    return this.generalizedCollectionMethod(
      orgsAndTokens,
      'repoCollaborators',
      capturedThis.crossOrganizationCollection(
        capturedThis,
        orgsAndTokens,
        options,
        cacheOptions,
        'repo',
        capturedThis.getAllRepos,
        'getRepoCollaborators',
        'collaborators',
        true),
    options,
    cacheOptions,
    createCallbackFlattenData(callback));
  }

  repoTeams(orgsAndTokens, options, cacheOptions, callback) {
    options.apiTypePrefix = 'github.x#';
    const capturedThis =  this;
    return this.generalizedCollectionMethod(
      orgsAndTokens,
      'repoTeams',
      capturedThis.crossOrganizationCollection(
        capturedThis,
        orgsAndTokens,
        options,
        cacheOptions,
        'repo',
        capturedThis.getAllRepos,
        'getRepoTeams',
        'teams',
        true),
      options,
      cacheOptions,
      createCallbackFlattenData(callback));
  }

  private generalizedCollectionMethod(token, apiName, method, options, cacheOptions, callback) {
    if (callback === undefined && typeof (cacheOptions) === 'function') {
      callback = cacheOptions;
      cacheOptions = {};
    }
    const apiContext = new CompositeApiContext(apiName, method, options);
    apiContext.maxAgeSeconds = cacheOptions.maxAgeSeconds || 600;
    apiContext.overrideToken(token);
    apiContext.libraryContext = this.libraryContext;
    if (cacheOptions.backgroundRefresh) {
      apiContext.backgroundRefresh = true;
    }
    // return
    this.libraryContext.compositeEngine.execute(apiContext).then(ok => {
      return callback(null, ok);
    }, callback);
  }

  private getCrossOrganizationMethod(orgsAndTokens, apiName, methodName, options, cacheOptions, callback) {
    const method = this.collectionsClient[methodName];
    if (!method) {
      throw new Error(`No method called ${method} defined in the collections client.`);
    }
    const capturedThis = this;
    const crossOrgMethod = function actualCrossOrgMethod() {
      const values: IOrganizationsResponse = {};
      values.headers = {};
      values.orgs = {};
      const deferred = Q.defer();
      async.eachOfLimit(orgsAndTokens, 1, (token, orgName, next) => {
        const localOptions = Object.assign({}, options);
        localOptions.org = orgName;
        if (!localOptions.per_page) {
          localOptions.per_page = capturedThis.libraryContext.defaultPageSize;
        }
        const localCacheOptions = Object.assign({}, cacheOptions);
        if (localCacheOptions.individualMaxAgeSeconds) {
          localCacheOptions.maxAgeSeconds = localCacheOptions.individualMaxAgeSeconds;
        }
        // method(token, localOptions, localCacheOptions, (orgError, orgValues) => {
        method.call(capturedThis.collectionsClient, token, localOptions, localCacheOptions, (orgError, orgValues) => {
          if (orgError) {
            return next(orgError);
          }
          if (!orgValues) {
            return next(new Error('No result'));
          }
          if (orgValues && orgValues.data) {
            console.warn(`${apiName} ${methodName} result has data that is being used instead of the parent object`);
            values.orgs[orgName] = orgValues.data;
            return next();
          }
          values.orgs[orgName] = orgValues;
          return next();
        });
      }, (error) => {
        if (error) {
          return deferred.reject(error);
        }
        const dataObject = {
          data: values,
          headers: values.headers,
        };
        delete values.headers;
        deferred.resolve(dataObject);
      });
      return deferred.promise;
    };
    return this.generalizedCollectionMethod(orgsAndTokens, apiName, crossOrgMethod, options, cacheOptions, callback);
  }

  private crossOrganizationCollection(capturedThis: CrossOrganizationCollator, orgsAndTokens, options, cacheOptions, innerKeyType, outerFunction, collectionMethodName, collectionKey, optionalSetOrganizationLogin) {
    return () => {
      const deferred = Q.defer();
      const entities: IIntelligentCacheResponseArray = [];
      entities.headers = {};
      outerFunction.call(capturedThis, orgsAndTokens, {}, cacheOptions, (outerError, data) => {
        let entitiesByOrg = null;
        if (!outerError && data && !data.data) {
          outerError = new Error('crossOrganizationCollection inner outerFunction returned an entity but no entity.data property was present');
        } else if (!outerError && data && data.data) {
          entitiesByOrg = data.data;
        }
        if (outerError) {
          return deferred.reject(outerError);
        }
        const localCacheOptions = Object.assign({}, cacheOptions);
        if (localCacheOptions.individualMaxAgeSeconds) {
          localCacheOptions.maxAgeSeconds = localCacheOptions.individualMaxAgeSeconds;
        }
        entities.headers = {};
        async.eachLimit(Object.getOwnPropertyNames(entitiesByOrg.orgs), 1, (orgName, nextOrg) => {
          const orgEntities = entitiesByOrg.orgs[orgName];
          async.eachLimit(orgEntities, 1, (orgEntity: any, next) => {
            const cloneTarget = optionalSetOrganizationLogin ? {
              organization: {
                login: orgName,
              }
            } : {};
            const entityClone = Object.assign(cloneTarget, orgEntity);
            const localOptionsTarget: ILocalOptionsParameters = {
              per_page: capturedThis.libraryContext.defaultPageSize,
            };
            switch (innerKeyType) {
            case 'team':
              localOptionsTarget.team_id = orgEntity.id;
              break;
            case 'repo':
              localOptionsTarget.owner = orgName;
              localOptionsTarget.repo = orgEntity.name;
              break;
            default:
              throw new Error(`Unsupported inner key type ${innerKeyType}`);
            }
            const localOptions = Object.assign(localOptionsTarget, options);
            delete localOptions.maxAgeSeconds;
            delete localOptions.backgroundRefresh;
            const token = orgsAndTokens[orgName.toLowerCase()];
            if (!token) {
              return next(new Error(`No token available for the org "${orgName}"`));
            }
            if (!this) {
              console.log('!');
            }
            this.collectionsClient[collectionMethodName](token, localOptions, localCacheOptions, (collectionsError, innerEntities) => {
              if (!collectionsError && innerEntities && innerEntities.data) {
                collectionsError = new Error(`innerEntities.data set from the ${collectionMethodName} collection method call`);
              }
              // This is a silent error for now, because there
              // are valid scenarios, i.e. team deletion, to consider.
              // In the future, get smarter here.
              if (collectionsError) {
                return next();
              }
              entityClone[collectionKey] = innerEntities;
              entities.push(entityClone);
              return next();
            });
          }, nextOrg);
        }, (error) => {
          const projectedToDataEntity: ICrossOrganizationDataResponse = {
            data: entities,
          };
          if (entities.cost) {
            projectedToDataEntity.cost = entities.cost;
            delete entities.cost;
          }
          if (entities.headers) {
            projectedToDataEntity.headers = entities.headers;
            delete entities.headers;
          }
          return error ? deferred.reject(error) : deferred.resolve(projectedToDataEntity);
        });
      });
      return deferred.promise;
    };
  }

  private getAllTeams(orgsAndTokens, options, cacheOptions, callback) {
    options.apiTypePrefix = 'github.x#';
    return this.getCrossOrganizationMethod(
      orgsAndTokens,
      'teams',
      'getOrgTeams',
      options,
      cacheOptions,
      callback);
  }

  private getAllRepos(orgsAndTokens, options, cacheOptions, callback) {
    options.apiTypePrefix = 'github.x#';
    return this.getCrossOrganizationMethod(
      orgsAndTokens,
      'repos',
      'getOrgRepos',
      options,
      cacheOptions,
      callback);
  }
}
