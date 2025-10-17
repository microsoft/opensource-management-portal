//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { RestResponse, IIntelligentCacheResponseArray, flattenData } from './core.js';
import { CompositeApiContext } from './composite.js';
import { RestLibrary } from './index.js';
import { RestCollections } from './collections.js';
import { throat } from '../../vendor/throat/index.js';
import {
  ICacheOptions,
  GetOrganizationMembersOptions,
  IPagedCrossOrganizationCacheOptions,
  PurposefulGetAuthorizationHeader,
  ITeamMembershipOptions,
} from '../../interfaces/index.js';
import { Operations, Organization } from '../../business/index.js';
import { CreateError } from '../transitional.js';

interface IOrganizationsResponse extends RestResponse {
  orgs?: any;
}

interface ILocalOptionsParameters {
  per_page: number;
  id?: string;
  team_id?: string;
  owner?: string;
  repo?: string;
}

enum InnerKeyType {
  Team = 'team',
  Repo = 'repo',
}

const parallelismCrossOrgs = 4;

export class CrossOrganizationCollator {
  public libraryContext: RestLibrary;
  // public collectionsClient: RestCollections;

  constructor(libraryContext: RestLibrary, collectionsClient: RestCollections) {
    this.libraryContext = libraryContext;
    // this.collectionsClient = collectionsClient;
  }

  async orgMembers(
    operations: Operations,
    orgsAndTokens: Map<string, PurposefulGetAuthorizationHeader>,
    options: GetOrganizationMembersOptions,
    cacheOptions: ICacheOptions
  ): Promise<any> {
    (options as any).apiTypePrefix = 'github.x#';
    const orgs = listToOrgs(operations, orgsAndTokens);
    const data = await this.getCrossOrganizationMethod(
      orgs,
      orgs[0].getMembers,
      /*  */ 'getMembers',
      options,
      cacheOptions
    );
    return flattenData(data);
  }

  async teams(
    operations: Operations,
    orgsAndTokens: Map<string, PurposefulGetAuthorizationHeader>,
    options: Record<string, any>,
    cacheOptions: ICacheOptions
  ) {
    const allTeams = await this.getAllTeams(operations, orgsAndTokens, options, cacheOptions);
    return flattenData(allTeams);
  }

  async teamMembers(
    operations: Operations,
    orgsAndTokens: Map<string, PurposefulGetAuthorizationHeader>,
    options: ITeamMembershipOptions,
    cacheOptions: ICacheOptions
  ): Promise<any> {
    (options as any).apiTypePrefix = 'github.x#';
    const generalizedData = await this.generalizedCollectionMethod(
      'teamMembers',
      this.crossOrganizationCollection.bind(
        this,
        operations,
        orgsAndTokens,
        options,
        cacheOptions,
        InnerKeyType.Team,
        this,
        this.getAllTeams,
        this.getTeamMembers,
        'getTeamMembers',
        'members',
        true
      ) as any,
      options,
      cacheOptions
    );
    return flattenData(generalizedData);
  }

  private async getTeamMembers(
    organization: Organization,
    teamEntity: any,
    options: Record<string, any>,
    cacheOptions: ICacheOptions
  ) {
    const team = organization.teamFromEntity(teamEntity);
    (cacheOptions as any).doNotProjectEntities = true;
    const teamMemberEntities = await team.getMembers(cacheOptions);
    return teamMemberEntities;
  }

  private async getRepoTeams(
    organization: Organization,
    repoEntity: any,
    options: Record<string, any>,
    cacheOptions: ICacheOptions
  ) {
    const repository = organization.repositoryFromEntity(repoEntity);
    (cacheOptions as any).doNotProjectEntities = true;
    const teamEntities = await repository.getTeamPermissions(cacheOptions);
    return teamEntities;
  }

  async repos(
    operations: Operations,
    orgsAndTokens: Map<string, PurposefulGetAuthorizationHeader>,
    options: Record<string, any>,
    cacheOptions: ICacheOptions
  ): Promise<any> {
    const allRepos = await this.getAllRepos(operations, orgsAndTokens, options, cacheOptions);
    return flattenData(allRepos);
  }

  // async repoCollaborators(
  //   operations: Operations,
  //   orgsAndTokens: Map<string, PurposefulGetAuthorizationHeader>,
  //   options: Record<string, any>,
  //   cacheOptions: ICacheOptions
  // ): Promise<any> {
  //   options.apiTypePrefix = 'github.x#';
  //   const generalizedData = await this.generalizedCollectionMethod(
  //     'repoCollaborators',
  //     this.crossOrganizationCollection.bind(
  //       this,
  //       operations,
  //       orgsAndTokens,
  //       options,
  //       cacheOptions,
  //       InnerKeyType.Repo,
  //       this,
  //       this.getAllRepos,
  //       this.getRepoCollaborators,
  //       'getRepoCollaborators',
  //       'collaborators',
  //       true
  //     ) as any,
  //     options,
  //     cacheOptions
  //   );
  //   return flattenData(generalizedData);
  // }

  private async getRepoCollaborators(
    organization: Organization,
    repoEntity: any,
    options: Record<string, any>,
    cacheOptions: ICacheOptions
  ) {
    const repository = organization.repositoryFromEntity(repoEntity);
    (cacheOptions as any).doNotProjectEntities = true;
    const collaboratorEntities = await repository.getCollaborators(cacheOptions);
    return collaboratorEntities;
  }

  async repoTeams(
    operations: Operations,
    orgsAndTokens: Map<string, PurposefulGetAuthorizationHeader>,
    options: IPagedCrossOrganizationCacheOptions,
    cacheOptions: ICacheOptions
  ): Promise<any> {
    (options as any).apiTypePrefix = 'github.x#';
    const generalizedData = await this.generalizedCollectionMethod(
      'repoTeams',
      this.crossOrganizationCollection.bind(
        this,
        operations,
        orgsAndTokens,
        options,
        cacheOptions,
        InnerKeyType.Repo,
        this,
        this.getAllRepos,
        this.getRepoTeams,
        'getRepoTeams',
        'teams',
        true
      ) as any,
      options,
      cacheOptions
    );
    return flattenData(generalizedData);
  }

  private async generalizedCollectionMethod(
    // token,
    apiName: string,
    method: (...args) => Promise<any>,
    options: Record<string, any>,
    cacheOptions?: ICacheOptions
  ): Promise<any> {
    // IIntelligentEngineResponse
    cacheOptions = cacheOptions || {};
    const apiContext = new CompositeApiContext(apiName, method, options);
    apiContext.maxAgeSeconds = cacheOptions.maxAgeSeconds || 600;
    // apiContext.overrideToken(token);
    apiContext.libraryContext = this.libraryContext;
    if (cacheOptions.backgroundRefresh) {
      apiContext.backgroundRefresh = true;
    }
    const res = await this.libraryContext.compositeEngine.execute(apiContext);
    return res;
  }

  private async getCrossOrganizationMethod(
    orgs: Organization[],
    exampleCallToValidate: () => Promise<any>,
    methodName: string,
    options: Record<string, any>,
    cacheOptions: IPagedCrossOrganizationCacheOptions
  ): Promise<any> {
    const { libraryContext } = this;
    const crossOrgMethod = async function actualCrossOrgMethod(): Promise<any> {
      const values: IOrganizationsResponse = {
        headers: {},
        orgs: {},
        data: undefined,
      };
      // CONSIDER: parallelism
      for (const org of orgs) {
        const localOptions = Object.assign({}, options);
        if (!localOptions.per_page) {
          localOptions.per_page = libraryContext.defaultPageSize;
        }
        const localCacheOptions = Object.assign({}, cacheOptions);
        if (localCacheOptions.individualMaxAgeSeconds) {
          localCacheOptions.maxAgeSeconds = localCacheOptions.individualMaxAgeSeconds;
        }
        try {
          const boundMethod = org[methodName].bind(org);
          const orgValues = await boundMethod.call(org, localOptions, localCacheOptions);
          if (!orgValues) {
            throw new Error('No result');
          }
          if (orgValues && orgValues.data) {
            console.warn(`${methodName} result has data that is being used instead of the parent object`);
            values.orgs[org.name] = orgValues.data;
          } else {
            values.orgs[org.name] = orgValues;
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
    const apiName = methodName;
    return await this.generalizedCollectionMethod(apiName, crossOrgMethod, options, cacheOptions);
  }

  private async crossOrganizationCollection(
    operations: Operations,
    orgsAndTokens: Map<string, PurposefulGetAuthorizationHeader>,
    options: Record<string, any>,
    cacheOptions: IPagedCrossOrganizationCacheOptions,
    innerKeyType: InnerKeyType,
    outerFunctionBoundObject: object,
    outerFunction: (
      operations: Operations,
      orgsAndTokens: Map<string, PurposefulGetAuthorizationHeader>,
      options: Record<string, any>,
      cacheOptions: IPagedCrossOrganizationCacheOptions
    ) => Promise<any>,
    ignoredMethodOnThisInstance: (...args) => Promise<any>,
    collectionMethodName: string,
    collectionKey: string,
    optionalSetOrganizationLogin: boolean
  ): Promise<any> {
    const orgs = listToOrgs(operations, orgsAndTokens);
    const { libraryContext } = this;
    const entities = [] as IIntelligentCacheResponseArray;
    entities.headers = {};
    let data = null;
    try {
      data = await outerFunction.call(outerFunctionBoundObject, operations, orgsAndTokens, {}, cacheOptions);
    } catch (outerError) {
      throw outerError;
    }
    let entitiesByOrg = null;
    if (data && !data.data) {
      throw new Error(
        'crossOrganizationCollection inner outerFunction returned an entity but no entity.data property was present'
      );
    } else if (data && data.data) {
      entitiesByOrg = data.data;
    }
    const localCacheOptions = Object.assign({}, cacheOptions);
    if (localCacheOptions.individualMaxAgeSeconds) {
      localCacheOptions.maxAgeSeconds = localCacheOptions.individualMaxAgeSeconds;
    }
    entities.headers = {};
    const orgNames = Object.getOwnPropertyNames(entitiesByOrg.orgs);
    const processOrganizationInParallel = async (orgName: string) => {
      const orgCollectedEntities: IIntelligentCacheResponseArray[] = [];
      // const orgName = orgNames[i];
      const organization = orgs.find((org) => org.name.toLowerCase() === orgName.toLowerCase());
      const orgEntities = entitiesByOrg.orgs[orgName];
      for (const orgEntity of orgEntities) {
        const cloneTarget = optionalSetOrganizationLogin
          ? {
              organization: {
                login: orgName,
              },
            }
          : {};
        const entityClone = Object.assign(cloneTarget, orgEntity);
        const localOptionsTarget: ILocalOptionsParameters = {
          per_page: libraryContext.defaultPageSize,
        };
        switch (innerKeyType) {
          case InnerKeyType.Team: {
            localOptionsTarget.team_id = orgEntity.id;
            break;
          }
          case InnerKeyType.Repo: {
            localOptionsTarget.owner = orgName;
            localOptionsTarget.repo = orgEntity.name;
            break;
          }
          default: {
            throw new Error(`Unsupported inner key type ${innerKeyType}`);
          }
        }
        const localOptions = Object.assign(localOptionsTarget, options);
        delete localOptions.maxAgeSeconds;
        delete localOptions.backgroundRefresh;
        const token = orgsAndTokens.get(orgName.toLowerCase()) as PurposefulGetAuthorizationHeader;
        if (!token) {
          throw new Error(`No token available for the organization ${orgName}`);
        }
        let innerEntities = null;
        let collectionsError = null;
        try {
          if (!this[collectionMethodName]) {
            throw CreateError.InvalidParameters('collectionMethodName');
          }
          innerEntities = await this[collectionMethodName](
            organization,
            // token(AppPurpose.Data),
            entityClone,
            localOptions,
            localCacheOptions
          );
        } catch (error) {
          // This is a silent error for now, because there
          // are valid scenarios, i.e. team deletion, to consider.
          // In the future, get smarter here.
          collectionsError = error;
        }
        if (!collectionsError && innerEntities && innerEntities.data) {
          collectionsError = new Error(
            `innerEntities.data set from the ${collectionMethodName} collection method call`
          );
        }
        if (!collectionsError) {
          entityClone[collectionKey] = innerEntities;
          orgCollectedEntities.push(entityClone);
        }
      }
      entities.push(...orgCollectedEntities);
      console.log(`Processed ${orgName} with ${orgCollectedEntities.length} entities`);
    };
    const throttle = throat(parallelismCrossOrgs);
    await throttle(() => Promise.all(orgNames.map((orgName) => processOrganizationInParallel(orgName))));
    const projectedToDataEntity: RestResponse = {
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

  private async getAllTeams(
    operations: Operations,
    orgsAndTokens: Map<string, PurposefulGetAuthorizationHeader>,
    options: Record<string, any>,
    cacheOptions: IPagedCrossOrganizationCacheOptions
  ): Promise<any> {
    (options as any).doNotProjectEntities = true;
    const orgs = listToOrgs(operations, orgsAndTokens);
    options.apiTypePrefix = 'github.x#';
    const data = await this.getCrossOrganizationMethod(
      orgs,
      orgs[0].getTeams,
      /*  */ 'getTeams',
      options,
      cacheOptions
    );
    return data;
  }

  private async getAllRepos(
    operations: Operations,
    orgsAndTokens: Map<string, PurposefulGetAuthorizationHeader>,
    options: Record<string, any>,
    cacheOptions: IPagedCrossOrganizationCacheOptions
  ): Promise<any> {
    (options as any).doNotProjectEntities = true;
    const orgs = listToOrgs(operations, orgsAndTokens);
    options.apiTypePrefix = 'github.x#';
    const data = await this.getCrossOrganizationMethod(
      orgs,
      orgs[0].getRepositories,
      /*  */ 'getRepositories',
      options,
      cacheOptions
    );
    return data;
  }
}

function listToOrgs(
  operations: Operations,
  orgNamesAndTokens: Map<string, PurposefulGetAuthorizationHeader>
) {
  const orgNames = Array.from(orgNamesAndTokens.keys()).sort((a, b) => a.localeCompare(b));
  const orgs: Organization[] = [];
  for (const name of orgNames) {
    const org = operations.getOrganization(name);
    if (org) {
      orgs.push(org);
    } else {
      console.log(`Organization ${name} not found in the list of organizations`);
    }
  }
  return orgs;
}
