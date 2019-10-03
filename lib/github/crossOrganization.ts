//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

/*eslint no-console: ["error", { allow: ["warn"] }] */

'use strict';

import { IIntelligentCacheObjectResponse, IIntelligentCacheResponseArray, createCallbackFlattenData, flattenData } from './core';
import { CompositeApiContext } from './composite';
import { RestLibrary } from '.';
import { RestCollections } from './collections';
import { OrganizationMembershipRoleQuery, IGetOrganizationMembersOptions } from '../../business/organization';
import { ITeamMembershipOptions } from '../../business/team';

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
  public libraryContext: RestLibrary;
  public collectionsClient: RestCollections;

  constructor(libraryContext: RestLibrary, collectionsClient: RestCollections) {
    this.libraryContext = libraryContext;
    this.collectionsClient = collectionsClient;
  }

  async orgMembers(orgsAndTokens, options: IGetOrganizationMembersOptions, cacheOptions): Promise<any> {
    options['apiTypePrefix'] = 'github.x#';
    const data = await this.getCrossOrganizationMethod(orgsAndTokens, 'orgMembers', 'getOrgMembers', options, cacheOptions);
    return flattenData(data);
  }

  async teams(orgsAndTokens, options, cacheOptions) {
    const allTeams = await this.getAllTeams(orgsAndTokens, options, cacheOptions);
    return flattenData(allTeams);
  }

  async teamMembers(orgsAndTokens, options: ITeamMembershipOptions, cacheOptions): Promise<any> {
    options['apiTypePrefix'] = 'github.x#';
    const capturedThis = this;
    const generalizedData = await this.generalizedCollectionMethod(
      orgsAndTokens,
      'teamMembers',
      capturedThis.crossOrganizationCollection(capturedThis, orgsAndTokens, options, cacheOptions, 'team', capturedThis.getAllTeams, 'getTeamMembers', 'members', true),
      options,
      cacheOptions);
    return flattenData(generalizedData);
  }

  async repos(orgsAndTokens, options, cacheOptions): Promise<any> {
    const allRepos = await this.getAllRepos(orgsAndTokens, options, cacheOptions);
    return flattenData(allRepos);
  }

  async repoCollaborators(orgsAndTokens, options, cacheOptions): Promise<any> {
    options.apiTypePrefix = 'github.x#';
    const capturedThis =  this;
    const generalizedData = await this.generalizedCollectionMethod(
      orgsAndTokens,
      'repoCollaborators',
      capturedThis.crossOrganizationCollection(capturedThis, orgsAndTokens, options, cacheOptions, 'repo', capturedThis.getAllRepos, 'getRepoCollaborators', 'collaborators', true),
      options,
      cacheOptions);
    return flattenData(generalizedData);
  }

  async repoTeams(orgsAndTokens, options, cacheOptions): Promise<any> {
    options.apiTypePrefix = 'github.x#';
    const capturedThis =  this;
    const generalizedData = await this.generalizedCollectionMethod(
      orgsAndTokens,
      'repoTeams',
      capturedThis.crossOrganizationCollection(capturedThis, orgsAndTokens, options, cacheOptions, 'repo', capturedThis.getAllRepos, 'getRepoTeams', 'teams', true),
      options,
      cacheOptions);
    return flattenData(generalizedData);
  }

  private generalizedCollectionMethod(token, apiName, method, options, cacheOptions?): Promise<any> { // IIntelligentEngineResponse
    cacheOptions = cacheOptions || {};
    const apiContext = new CompositeApiContext(apiName, method, options);
    apiContext.maxAgeSeconds = cacheOptions.maxAgeSeconds || 600;
    apiContext.overrideToken(token);
    apiContext.libraryContext = this.libraryContext;
    if (cacheOptions.backgroundRefresh) {
      apiContext.backgroundRefresh = true;
    }
    return this.libraryContext.compositeEngine.execute(apiContext);
  }

  private async getCrossOrganizationMethod(orgsAndTokens, apiName: string, methodName: string, options, cacheOptions): Promise<any> {
    const method = this.collectionsClient[methodName];
    if (!method) {
      throw new Error(`No method called ${method} defined in the collections client.`);
    }
    const capturedThis = this;
    const crossOrgMethod = async function actualCrossOrgMethod(): Promise<any> {
      const values: IOrganizationsResponse = {};
      values.headers = {};
      values.orgs = {};
      for (let orgName in orgsAndTokens) {
        const token = orgsAndTokens[orgName];
        const localOptions = Object.assign({}, options);
        localOptions.org = orgName;
        if (!localOptions.per_page) {
          localOptions.per_page = capturedThis.libraryContext.defaultPageSize;
        }
        const localCacheOptions = Object.assign({}, cacheOptions);
        if (localCacheOptions.individualMaxAgeSeconds) {
          localCacheOptions.maxAgeSeconds = localCacheOptions.individualMaxAgeSeconds;
        }
        try {
          const orgValues = await method.call(capturedThis.collectionsClient, token, localOptions, localCacheOptions);
          if (!orgValues) {
            throw new Error('No result');
          }
          if (orgValues && orgValues.data) {
            console.warn(`${apiName} ${methodName} result has data that is being used instead of the parent object`);
            values.orgs[orgName] = orgValues.data;
          } else {
            values.orgs[orgName] = orgValues;
          }
        } catch (orgError) {
          throw orgError;
        }
      }
      const dataObject = {
        data: values,
        headers: values.headers,
      };
      delete values.headers;
      return dataObject;
    };
    return this.generalizedCollectionMethod(orgsAndTokens, apiName, crossOrgMethod, options, cacheOptions);
  }

  private crossOrganizationCollection(capturedThis: CrossOrganizationCollator, orgsAndTokens, options, cacheOptions, innerKeyType, outerFunction, collectionMethodName: string, collectionKey, optionalSetOrganizationLogin) {
    return async (): Promise<any> => {
      const entities: IIntelligentCacheResponseArray = [];
      entities.headers = {};
      let data = null;
      try {
        data = await outerFunction.call(capturedThis, orgsAndTokens, {}, cacheOptions);
      } catch (outerError) {
        throw outerError;
      }
      let entitiesByOrg = null;
      if (data && !data.data) {
        throw new Error('crossOrganizationCollection inner outerFunction returned an entity but no entity.data property was present');
      } else if (data && data.data) {
        entitiesByOrg = data.data;
      }
      const localCacheOptions = Object.assign({}, cacheOptions);
      if (localCacheOptions.individualMaxAgeSeconds) {
        localCacheOptions.maxAgeSeconds = localCacheOptions.individualMaxAgeSeconds;
      }
      entities.headers = {};
      const orgNames = Object.getOwnPropertyNames(entitiesByOrg.orgs);
      for (let i = 0; i < orgNames.length; i++) {
        const orgName = orgNames[i];
        const orgEntities = entitiesByOrg.orgs[orgName];
        for (const orgEntity of orgEntities) {
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
            throw new Error(`No token available for the organization ${orgName}`);
          }
          let innerEntities = null;
          let collectionsError = null;
          try {
            innerEntities = await this.collectionsClient[collectionMethodName](token, localOptions, localCacheOptions);
          } catch (error) {
            // This is a silent error for now, because there
            // are valid scenarios, i.e. team deletion, to consider.
            // In the future, get smarter here.
            collectionsError = error;
          }
          if (!collectionsError && innerEntities && innerEntities.data) {
            collectionsError = new Error(`innerEntities.data set from the ${collectionMethodName} collection method call`);
          }
          if (!collectionsError) {
            entityClone[collectionKey] = innerEntities;
            entities.push(entityClone);
          }
        }
      }
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
      return projectedToDataEntity;
    }
  }

  private async getAllTeams(orgsAndTokens, options, cacheOptions): Promise<any> {
    options.apiTypePrefix = 'github.x#';
    const data = await this.getCrossOrganizationMethod(orgsAndTokens, 'teams', 'getOrgTeams', options, cacheOptions);
    return data;
  }

  private async getAllRepos(orgsAndTokens, options, cacheOptions): Promise<any> {
    options.apiTypePrefix = 'github.x#';
    const data = await this.getCrossOrganizationMethod(orgsAndTokens, 'repos', 'getOrgRepos', options, cacheOptions);
    return data;
  }
}
