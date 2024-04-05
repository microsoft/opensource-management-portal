//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

// This code adopted from our existing jobs code

import cache from 'memory-cache';
import axios, { AxiosError } from 'axios';
import querystring from 'querystring';
import validator from 'validator';

import {
  IGraphProvider,
  IGraphEntry,
  IGraphEntryWithManager,
  IGraphGroupMember,
  IGraphGroup,
  GraphUserType,
} from '.';
import { ErrorHelper, CreateError, splitSemiColonCommas } from '../transitional';
import { ICacheHelper } from '../caching';

const axios12BufferDecompressionBugHeaderAddition = true;

export interface IMicrosoftGraphProviderOptions {
  tokenCacheSeconds?: string | number;
  clientId: string;
  clientSecret: string;
  tokenEndpoint?: string;
  tenantId?: string;
  cacheProvider?: ICacheHelper;
  skipManagerLookupForIds?: string;
}

export type MicrosoftGraphGroupMembersOptions = {
  getCount?: boolean;
  maximumPages?: number;
  throwOnMaximumPages?: boolean;
  skipCache?: boolean;
  additionalSelectValues?: string[];
  membership?: MicrosoftGraphGroupMembershipType;
};

export enum MicrosoftGraphGroupMembershipType {
  Transitive = 'transitiveMembers',
  Direct = 'members',
}

export type MicrosoftGraphGroupMember = IGraphGroupMember & {
  userType?: GraphUserType;
};

export function microsoftGraphUserTypeFromString(type: string): GraphUserType {
  if (!type) {
    return;
  }
  switch (type) {
    case GraphUserType.Guest:
      return GraphUserType.Guest;
    case GraphUserType.Member:
      return GraphUserType.Member;
    default:
      return GraphUserType.Unknown;
  }
}

type GraphCheckMembersRequest = {
  ids: string[];
};

type GraphCheckMembersResponse = {
  value: string[];
};

const graphBaseUrl = 'https://graph.microsoft.com/v1.0/';
const odataNextLink = '@odata.nextLink';
const defaultCachePeriodMinutes = 60 * 36; // 36 hours

const attemptCacheGet = true;

type MicrosoftGraphCallOptions = {
  selectValues?: string;
  filterValues?: string;
  orderBy?: string;
  body?: any;
  count?: boolean;
  consistencyLevel?: 'eventual';
};

type GraphCacheOptions = {
  skipCache?: boolean;
  maximumPages?: number;
  throwOnMaximumPages?: boolean;
};

type GraphOptions = MicrosoftGraphCallOptions & GraphCacheOptions;

export class MicrosoftGraphProvider implements IGraphProvider {
  #_tokenCacheMilliseconds: number;
  #_clientSecret: string;
  #_staticManagerEntryCacheById: Map<string, IGraphEntryWithManager>;
  #_tenantId: string;
  #_tokenEndpoint: string;
  #_cache: ICacheHelper;
  #_skipManagerLookupForIds: string[];

  public clientId: string;

  constructor(graphOptions: IMicrosoftGraphProviderOptions) {
    this.#_staticManagerEntryCacheById = new Map();
    const secondsString = (graphOptions.tokenCacheSeconds || '60').toString();
    this.#_tokenCacheMilliseconds = parseInt(secondsString, 10) * 1000;
    this.clientId = graphOptions.clientId;
    this.#_clientSecret = graphOptions.clientSecret;
    this.#_tenantId = graphOptions.tenantId;
    this.#_tokenEndpoint = graphOptions.tokenEndpoint;
    this.#_skipManagerLookupForIds = [];
    if (graphOptions.skipManagerLookupForIds) {
      this.#_skipManagerLookupForIds = splitSemiColonCommas(graphOptions.skipManagerLookupForIds);
    }
    this.#_cache = graphOptions.cacheProvider;
    if (!this.clientId) {
      throw new Error('MicrosoftGraphProvider: clientId required');
    }
    if (!this.#_clientSecret) {
      throw new Error('MicrosoftGraphProvider: clientSecret required');
    }
  }

  async isUserInGroup(corporateId: string, securityGroupId: string): Promise<boolean> {
    // Formerly used a very inefficient approach:
    // const members = await this.getGroupMembers(securityGroupId);
    // return members.filter((m) => m.id === corporateId).length > 0;
    return await this.checkMemberObjectsForUserId(corporateId, securityGroupId);
  }

  private async checkMemberObjectsForUserId(corporateId: string, securityGroupId: string): Promise<boolean> {
    const requestBody: GraphCheckMembersRequest = {
      ids: [securityGroupId],
    };
    const url = `${graphBaseUrl}users/${corporateId}/checkMemberObjects`;
    const response = await this.request<GraphCheckMembersResponse>(
      url,
      requestBody,
      null,
      true
    ); /* no cache */
    const foundGroupIds = response.value;
    const found = foundGroupIds.includes(securityGroupId);
    return found;
  }

  private async getTokenThenEntity(aadId: string, resource: string): Promise<unknown> {
    const accessToken = await this.getToken();
    return await this.getUserByIdLookup(aadId, accessToken, resource);
  }

  async getManagerById(aadId: string) {
    const entity = (await this.getTokenThenEntity(aadId, 'manager')) as IGraphEntry;
    return entity;
  }

  async getUserAndManagerById(aadId: string): Promise<IGraphEntryWithManager> {
    const entity = (await this.getTokenThenEntity(aadId, null)) as IGraphEntryWithManager;
    if (this.#_skipManagerLookupForIds?.includes(aadId)) {
      return entity;
    }
    try {
      const manager = (await this.getTokenThenEntity(aadId, 'manager')) as IGraphEntry;
      if (manager) {
        entity.manager = manager;
      }
    } catch (warning) {
      if (ErrorHelper.IsNotFound(warning)) {
        console.warn(`Manager not found for AAD ID ${aadId}`);
      } else {
        console.warn(warning);
      }
    }
    return entity;
  }

  async getManagementChain(corporateId: string): Promise<IGraphEntryWithManager[]> {
    const chain = [];
    try {
      let entry = await this.getCachedEntryWithManagerById(corporateId);
      while (entry) {
        const clone = { ...entry };
        delete clone.manager;
        chain.push(clone);
        entry =
          entry.manager && entry.manager.id
            ? await this.getCachedEntryWithManagerById(entry.manager.id)
            : null;
      }
    } catch (getError) {
      if (ErrorHelper.IsNotFound(getError)) {
        return null;
      } else {
        console.dir(getError);
        throw getError;
      }
    }
    return chain;
  }

  async getCachedEntryWithManagerById(corporateId: string): Promise<IGraphEntryWithManager> {
    let entry = this.#_staticManagerEntryCacheById.get(corporateId);
    if (entry) {
      return entry;
    }
    entry = await this.getUserAndManagerById(corporateId);
    this.#_staticManagerEntryCacheById.set(corporateId, entry);
    return entry;
  }

  async getUserById(id: string): Promise<IGraphEntry> {
    try {
      const info = await this.getTokenThenEntity(id, null);
      return info as IGraphEntry;
    } catch (error) {
      if (ErrorHelper.IsNotFound(error)) {
        return null;
      }
      throw error;
    }
  }

  async getGroup(corporateGroupId: string): Promise<IGraphGroup> {
    const selectValues = 'description,displayName,id,mail,mailNickname';
    // if (additionalSelectValues) {
    //   selectValues = Array.from(
    //     new Set<string>([...selectValues.split(','), ...additionalSelectValues]).values()
    //   ).join(',');
    // }
    // prettier-ignore
    const response = await this.lookupInGraph([
      'groups',
      corporateGroupId,
    ], {
      selectValues,
    });
    return response;
  }

  async getGroupsByNickname(nickname: string): Promise<string[]> {
    // prettier-ignore
    const response = (await this.lookupInGraph([
      'groups',
    ], {
      filterValues: `mailNickname eq '${encodeURIComponent(nickname)}'`,
      selectValues: 'id',
    })) as any[];
    if (response?.map) {
      return response.map((entry) => entry.id);
    }
    const values = (response as any).value as any[];
    return values.map((entry) => entry.id);
  }

  async getMailAddressByUsername(corporateUsername: string): Promise<string> {
    // prettier-ignore
    const response = await this.lookupInGraph([
      'users',
      corporateUsername,
    ], {
      selectValues: 'mail',
    });
    return response && response.mail ? response.mail : null;
  }

  async getUserIdByUsername(corporateUsername: string): Promise<string> {
    // prettier-ignore
    const response = await this.lookupInGraph([
      'users',
      corporateUsername,
    ], {
      selectValues: 'id',
    });
    return response?.id;
  }

  async getUserIdByNickname(nickname: string): Promise<string> {
    // prettier-ignore
    const response = (await this.lookupInGraph([
      'users',
    ], {
      filterValues: `mailNickname eq '${encodeURIComponent(nickname)}'`,
      selectValues: 'id',
    })) as any[];
    if (!response || response.length === 0) {
      return null;
    }
    if (Array.isArray(response)) {
      return response.map((entry) => entry.id)[0];
    }
    const subResponse = (response as any).value ? (response as any).value : [];
    return subResponse.map((entry) => entry.id)[0];
  }

  async getUserIdByMail(mail: string): Promise<string> {
    // prettier-ignore
    const response = (await this.lookupInGraph([
      'users',
    ], {
      filterValues: `mail eq '${mail}'`, // encodeURIComponent(
      selectValues: 'id',
      // count: true,
      // consistencyLevel: 'eventual',
    })) as any[];
    if (!response || response.length === 0) {
      return null;
    }
    if (Array.isArray(response)) {
      return response.map((entry) => entry.id)[0];
    }
    const subResponse = (response as any).value ? (response as any).value : [];
    return subResponse.map((entry) => entry.id)[0];
  }

  async getUsersByIds(userIds: string[]): Promise<IGraphEntry[]> {
    if (!userIds || userIds.length === 0) {
      return [];
    }
    let response = (await this.lookupInGraph(['users'], {
      filterValues: userIds.map((id) => `id eq '${id.trim()}'`).join(' or '),
      selectValues: 'id,displayName,mailNickname,mail,userPrincipalName,userType,jobTitle',
    })) as any[];
    // caching issues...
    if (!response.filter && (response as any).value?.filter) {
      response = (response as any).value;
    }
    return response
      .filter((e) => e.userType !== GraphUserType.Guest)
      .map((entry) => {
        return {
          id: entry.id,
          mailNickname: entry.mailNickname,
          displayName: entry.displayName,
          mail: entry.mail,
          givenName: entry.givenName,
          userPrincipalName: entry.userPrincipalName,
          jobTitle: entry.jobTitle,
        };
      });
  }

  async getDirectReports(corporateIdOrUpn: string): Promise<IGraphEntry[]> {
    // prettier-ignore
    let response = (await this.lookupInGraph([
      'users',
      corporateIdOrUpn,
      'directReports',
    ], {
      selectValues: 'id,displayName,mailNickname,mail,userPrincipalName,userType,jobTitle',
    })) as any[];
    if (!response.filter && (response as any).value?.filter) {
      response = (response as any).value;
    }
    return response
      .filter((e) => e.userType !== GraphUserType.Guest)
      .map((entry) => {
        return {
          id: entry.id,
          mailNickname: entry.mailNickname,
          displayName: entry.displayName,
          mail: entry.mail,
          givenName: entry.givenName,
          userPrincipalName: entry.userPrincipalName,
          jobTitle: entry.jobTitle,
        };
      });
  }

  async getUsersByMailNicknames(mailNicknames: string[]): Promise<IGraphEntry[]> {
    // prettier-ignore
    let response = (await this.lookupInGraph([
      'users',
    ], {
      filterValues: mailNicknames.map((alias) => `mailNickname eq '${alias.trim()}'`).join(' or '),
      selectValues: 'id,displayName,mailNickname,mail,userPrincipalName,userType,jobTitle',
    })) as any[];
    if (!response.filter && (response as any).value?.filter) {
      response = (response as any).value;
    }
    return response
      .filter((e) => e.userType !== GraphUserType.Guest)
      .map((entry) => {
        return {
          id: entry.id,
          mailNickname: entry.mailNickname,
          displayName: entry.displayName,
          mail: entry.mail,
          givenName: entry.givenName,
          userPrincipalName: entry.userPrincipalName,
          jobTitle: entry.jobTitle,
        };
      });
  }

  async getUsersBySearch(minimum3Characters: string): Promise<IGraphEntry[]> {
    if (!minimum3Characters || minimum3Characters.length < 3) {
      throw new Error(`Minimum 3 characters required: ${minimum3Characters}`);
    }
    minimum3Characters = minimum3Characters.replace(/'/g, "''");
    // prettier-ignore
    let response = (await this.lookupInGraph([
      'users',
    ], {
      filterValues: `startswith(givenName, '${minimum3Characters}') or startswith(surname, '${minimum3Characters}') or startswith(displayName, '${minimum3Characters}') or startswith(mailNickname, '${minimum3Characters}') or startswith(mail, '${minimum3Characters}')`,
      selectValues: 'id,displayName,mailNickname,mail,userPrincipalName,userType,jobTitle',
    })) as any[];
    if (!response.filter && (response as any).value?.filter) {
      response = (response as any).value;
    }
    return response
      .filter((e) => e.userType !== GraphUserType.Guest)
      .map((entry) => {
        return {
          id: entry.id,
          mailNickname: entry.mailNickname,
          displayName: entry.displayName,
          mail: entry.mail,
          givenName: entry.givenName,
          userPrincipalName: entry.userPrincipalName,
          jobTitle: entry.jobTitle,
        };
      });
  }

  async getGroupMembers(
    corporateGroupId: string,
    options?: MicrosoftGraphGroupMembersOptions
  ): Promise<MicrosoftGraphGroupMember[]> {
    const defaultSelectSet = ['id', 'userPrincipalName'];
    const selectValuesSet = new Set<string>([
      ...defaultSelectSet,
      ...(options?.additionalSelectValues || []),
    ]);
    const graphOptions: GraphOptions = {
      selectValues: Array.from(selectValuesSet.values()).join(','),
    };
    if (options?.getCount !== undefined) {
      graphOptions.count = true;
      graphOptions.consistencyLevel = 'eventual';
    }
    if (options?.maximumPages !== undefined) {
      graphOptions.maximumPages = options.maximumPages;
    }
    if (options?.throwOnMaximumPages !== undefined) {
      graphOptions.throwOnMaximumPages = options.throwOnMaximumPages;
    }
    const lookupType = options?.membership || MicrosoftGraphGroupMembershipType.Transitive;
    const includesUserType = selectValuesSet.has('userType');
    const response = (await this.lookupInGraph(
      ['groups', corporateGroupId, lookupType],
      graphOptions
    )) as any[];
    if (Array.isArray(response)) {
      return response.map((entry) => {
        return {
          id: entry.id,
          userPrincipalName: entry.userPrincipalName,
          userType: includesUserType ? microsoftGraphUserTypeFromString(entry.userType) : undefined,
        };
      });
    }
    const subResponse = (response as any).value ? (response as any).value : [];
    return subResponse.map((entry) => {
      return {
        id: entry.id,
        userPrincipalName: entry.userPrincipalName,
        userType: includesUserType ? microsoftGraphUserTypeFromString(entry.userType) : undefined,
      };
    });
  }

  async getGroupsStartingWith(minimum3Characters: string): Promise<IGraphGroup[]> {
    if (!minimum3Characters || minimum3Characters.length < 3) {
      throw new Error(`Minimum 3 characters required: ${minimum3Characters}`);
    }

    let filterValues = `securityEnabled eq true and (startswith(displayName, '${minimum3Characters}') or startswith(mailNickname, '${minimum3Characters}'))`;
    if (validator.isUUID(minimum3Characters)) {
      filterValues = `securityEnabled eq true and (id eq '${minimum3Characters}' or startswith(displayName, '${minimum3Characters}') or startswith(mailNickname, '${minimum3Characters}'))`;
    }

    // NOTE: this is currently explicitly looking for Security Groups only
    // prettier-ignore
    let response = (await this.lookupInGraph([
      'groups',
    ], {
      filterValues,
      selectValues: 'id,displayName,mailNickname',
    })) as any[];
    if (!response.filter && (response as any).value?.filter) {
      response = (response as any).value;
    }
    return response.map((entry) => {
      return { id: entry.id, mailNickname: entry.mailNickname, displayName: entry.displayName };
    });
  }

  async getGroupsByMail(groupMailAddress: string): Promise<string[]> {
    let response = (await this.lookupInGraph(['groups'], {
      filterValues: `mail eq '${groupMailAddress}'`,
      selectValues: 'id',
    })) as any[];
    if (!response.filter && (response as any).value?.filter) {
      response = (response as any).value;
    }
    return response.map((entry) => entry.id);
  }

  async getGroupsById(corporateId: string): Promise<string[]> {
    // prettier-ignore
    const response = (await this.lookupInGraph(
      ['users',
      corporateId,
      'getMemberGroups',
    ], {
      // selectValues: '',
      body: {
        securityEnabledOnly: true,
      },
    })) as string[];
    return response;
  }

  private async getUserByIdLookup(aadId: string, token: string, subResource: string): Promise<any> {
    if (!aadId) {
      throw CreateError.InvalidParameters('No user ID provided to lookup');
    }
    const extraPath = subResource ? `/${subResource}` : '';
    const url = `https://graph.microsoft.com/v1.0/users/${aadId}${extraPath}?$select=id,mailNickname,userType,displayName,givenName,mail,userPrincipalName,jobTitle`;
    if (this.#_cache && attemptCacheGet) {
      try {
        const cached = await this.#_cache.getObject(url);
        if (cached?.value) {
          return cached.value;
        }
      } catch (error) {
        if (!ErrorHelper.IsNotFound(error)) {
          console.warn(error);
        }
      }
    }
    try {
      const headers = {
        Authorization: `Bearer ${token}`,
      };
      if (axios12BufferDecompressionBugHeaderAddition) {
        headers['Accept-Encoding'] = 'identity';
      }
      const response = await axios({
        url,
        method: 'get',
        headers,
      });
      if (!response.data) {
        throw CreateError.NotFound(`${subResource || 'user'} not in directory for ${aadId}`);
      }
      if ((response.data as any).error?.message) {
        // axios returns unknown now
        throw CreateError.InvalidParameters((response.data as any).error.message);
      }
      if (this.#_cache) {
        this.#_cache
          .setObjectWithExpire(url, { value: response.data }, defaultCachePeriodMinutes)
          .then((ok) => {})
          .catch((err) => {});
      }
      return response.data;
    } catch (error) {
      const axiosError = error as AxiosError;
      if (axiosError?.response) {
        if (axiosError.response?.status === 404) {
          throw CreateError.NotFound(
            `${subResource || 'user'} not in the directory for '${aadId}'`,
            axiosError
          );
        } else if (axiosError.response?.status >= 500) {
          throw CreateError.ServerError('Graph server error', axiosError);
        } else if (axiosError.response?.status >= 400) {
          throw CreateError.InvalidParameters('Incorrect graph parameters', axiosError);
        }
      }
      throw error;
    }
  }

  private async lookupInGraph(entityPath: string[], options: GraphOptions): Promise<any> {
    // initial hacking on top of the API
    const skipCache = options?.skipCache === true;
    const subUrl = entityPath.map((item) => encodeURIComponent(item)).join('/');
    const queries = {};
    if (options.filterValues) {
      queries['$filter'] = options.filterValues;
    }
    if (options.selectValues) {
      queries['$select'] = options.selectValues;
    }
    if (options.orderBy) {
      queries['$orderby'] = options.orderBy;
    }
    if (options.count === true) {
      queries['$count'] = 'true';
    }
    let hasArray = false;
    let value = null;
    let url = `${graphBaseUrl}${subUrl}?${querystring.stringify(queries)}`;
    const originalUrl = url;
    try {
      if (this.#_cache && attemptCacheGet && !skipCache) {
        value = await this.#_cache.getObject(url);
        if (value?.cache) {
          if (Array.isArray(value.cache) && value.cache.length === 0) {
            // live lookup still
          } else if (typeof value.cache === 'object') {
            return value.cache as any;
          } else {
            console.log(`Potentially bad cache, skip quick return: ${value.cache}`);
          }
        }
      }
    } catch (error) {
      console.warn(error);
    }
    let pages = 0;
    const maximumPages = options?.maximumPages;
    do {
      const consistencyLevel = options.consistencyLevel;
      const body = await this.request<any>(url, options.body, consistencyLevel, skipCache);
      if (body.value && pages === 0) {
        hasArray = body && body.value && Array.isArray(body.value);
        if (hasArray) {
          value = body.value as any[];
        } else {
          value = body.value;
        }
      } else if (hasArray && body.value) {
        value = value.concat(body.value as any[]);
      } else if (!body.value) {
        value = body;
      } else {
        throw new Error(`Page ${pages} in response is not an array type but had a link: ${url}`);
      }
      if (body && body['@odata.count'] !== undefined) {
        const count = body['@odata.count'];
        // NOTE: we don't store or cache or return this today
        console.log(`Total objects in response: ${count}`);
      }
      ++pages;
      url = body && body[odataNextLink] ? body[odataNextLink] : null;
    } while (url && (maximumPages ? pages < maximumPages : true));
    if (pages >= maximumPages) {
      if (options.throwOnMaximumPages) {
        throw CreateError.InvalidParameters('Maximum pages exceeded for this resource');
      }
      console.warn(`WARN: Maximum pages exceeded for this resource: ${originalUrl}`);
    }
    if (this.#_cache) {
      try {
        this.#_cache
          .setObjectWithExpire(originalUrl, { cache: value }, defaultCachePeriodMinutes)
          .then(() => {})
          .catch((err) => {
            console.warn(err);
          });
      } catch (error) {
        console.warn(error);
      }
    }
    return value;
  }

  private async request<T>(
    url: string,
    body?: any,
    eventualConsistency?: string,
    skipCache?: boolean
  ): Promise<T> {
    const token = await this.getToken();
    const method = body ? 'post' : 'get';
    if (this.#_cache && attemptCacheGet && method === 'get' && !skipCache) {
      try {
        const value = await this.#_cache.getObject(url);
        if (value?.cache) {
          if (Array.isArray(value.cache) && value.cache.length === 0) {
            // live lookup still
          } else if (typeof value.cache === 'object') {
            return value.cache as any;
          }
        }
      } catch (error) {
        console.warn(error);
      }
    }
    try {
      const headers = {
        Authorization: `Bearer ${token}`,
        // ConsistencyLevel: undefined,
      };
      if (axios12BufferDecompressionBugHeaderAddition) {
        headers['Accept-Encoding'] = 'identity'; // gzip, deflate'
      }

      if (eventualConsistency) {
        headers['ConsistencyLevel'] = eventualConsistency;
      }
      const response = await axios({
        url,
        method,
        data: method === 'post' ? body : undefined,
        headers,
      });
      if (!response.data) {
        throw CreateError.ServerError('Empty response');
      }
      if ((response.data as any).error?.message) {
        throw CreateError.InvalidParameters((response.data as any).error.message);
      }
      if (this.#_cache && method === 'get') {
        this.#_cache
          .setObjectWithExpire(url, { cache: response.data }, defaultCachePeriodMinutes)
          .then(() => {})
          .catch((err) => {});
      }
      return response.data;
    } catch (error) {
      const axiosError = error as AxiosError;
      if (axiosError?.response) {
        if (axiosError.response?.status === 404) {
          const err = CreateError.NotFound('Not found', axiosError);
          err['url'] = url;
          throw error;
        } else if (axiosError.response?.status >= 500) {
          const err = CreateError.ServerError('Graph server error', axiosError);
          err['url'] = url;
          throw err;
        } else if (axiosError.response?.status >= 400) {
          const attemptedErrorData = axiosError.response?.data as any;
          throw CreateError.InvalidParameters(
            attemptedErrorData.error?.message || 'Incorrect graph parameters',
            axiosError
          );
        }
      }
      error['url'] = url;
      throw error;
    }
  }

  async getToken() {
    const clientId = this.clientId;
    const clientSecret = this.#_clientSecret;
    if (!clientId || !clientSecret) {
      throw new Error('The graph provider requires an AAD clientId and clientSecret.');
    }
    const tokenKey = this.clientId;
    const token = cache.get(tokenKey) as string;
    if (token) {
      return token;
    }
    const tokenEndpoint =
      this.#_tokenEndpoint || `https://login.microsoftonline.com/${this.#_tenantId}/oauth2/token`;
    // These are the parameters necessary for the OAuth 2.0 Client Credentials Grant Flow.
    // For more information, see Service to Service Calls Using Client Credentials (https://msdn.microsoft.com/library/azure/dn645543.aspx).
    try {
      const qs = {
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
        resource: 'https://graph.microsoft.com',
      };
      const response = await axios.post(tokenEndpoint, querystring.stringify(qs), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      });
      if (!response.data) {
        throw CreateError.ServerError('Empty response');
      }
      const data = response.data as any; // axios returns unknown now
      if (!data.access_token) {
        throw CreateError.InvalidParameters('No access token');
      }
      if (data.error?.message) {
        throw CreateError.InvalidParameters(data.error.message);
      }
      const accessToken = data.access_token as string;
      cache.put(tokenKey, accessToken, this.#_tokenCacheMilliseconds);
      return accessToken;
    } catch (error) {
      const axiosError = error as AxiosError;
      if (axiosError?.response) {
        console.log(`graph request error ${error.toString()} (client ${clientId})`);
        if (axiosError.response?.status === 404) {
          throw CreateError.NotFound('Not found', axiosError);
        } else if (axiosError.response?.status >= 500) {
          throw CreateError.ServerError('Graph server error', axiosError);
        } else if (axiosError.response?.status === 401) {
          throw CreateError.NotAuthenticated('Invalid authorization to access to the graph');
        } else if (axiosError.response?.status === 403) {
          throw CreateError.NotAuthorized('Not authorized to access the graph');
        } else if (axiosError.response?.status >= 400) {
          throw CreateError.InvalidParameters('Incorrect graph parameters', axiosError);
        }
      }
      throw error;
    }
  }
}
