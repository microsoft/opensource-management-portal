//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

// This code adopted from our existing jobs code

import cache from 'memory-cache';
import request from 'request';
import querystring from 'querystring';

import { IGraphProvider, IGraphEntry, IGraphEntryWithManager, IGraphGroupMember, IGraphGroup } from '.';
import { ErrorHelper, CreateError } from '../../transitional';

export interface IMicrosoftGraphProviderOptions {
  tokenCacheSeconds?: string | number;
  clientId: string;
  clientSecret: string;
  tokenEndpoint?: string;
  tenantId?: string;
}

const graphBaseUrl = 'https://graph.microsoft.com/v1.0/';
const odataNextLink = '@odata.nextLink';

interface IGraphOptions {
  selectValues?: string;
  filterValues?: string;
  orderBy?: string;
  body?: any;
}

export class MicrosoftGraphProvider implements IGraphProvider {
  #_tokenCacheMilliseconds: number;
  #_clientSecret: string;
  #_staticManagerEntryCacheById: Map<string, IGraphEntryWithManager>;
  #_tenantId: string;
  #_tokenEndpoint: string;

  public clientId: string;

  constructor(graphOptions: IMicrosoftGraphProviderOptions) {
    this.#_staticManagerEntryCacheById = new Map();
    const secondsString = (graphOptions.tokenCacheSeconds || '60').toString();
    this.#_tokenCacheMilliseconds = parseInt(secondsString, 10) * 1000;
    this.clientId = graphOptions.clientId;
    this.#_clientSecret = graphOptions.clientSecret;
    this.#_tenantId = graphOptions.tenantId;
    this.#_tokenEndpoint = graphOptions.tokenEndpoint;
    if (!this.clientId) {
      throw new Error('MicrosoftGraphProvider: clientId required');
    }
    if (!this.#_clientSecret) {
      throw new Error('MicrosoftGraphProvider: clientSecret required');
    }
  }

  getManagerById(aadId, callback) {
    this.getTokenThenEntity(aadId, 'manager', callback);
  }

  getUserAndManagerById(aadId, callback) {
    this.getTokenThenEntity(aadId, null, (error, user) => {
      if (error) {
        return callback(error);
      }
      this.getTokenThenEntity(aadId, 'manager', (noManager, manager) => {
        if (!error && manager) {
          user.manager = manager;
        }
        callback(null, user);
      });
    });
  }

  async getManagementChain(corporateId: string): Promise<IGraphEntryWithManager[]> {
    let chain = [];
    try {
      let entry = await this.getCachedEntryWithManagerById(corporateId);
      while (entry) {
        const clone = { ...entry };
        delete clone.manager;
        chain.push(clone);
        entry = entry.manager && entry.manager.id ? await this.getCachedEntryWithManagerById(entry.manager.id) : null;
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
    entry = await this.getUserAndManagerAsync(corporateId);
    this.#_staticManagerEntryCacheById.set(corporateId, entry);
    return entry;
  }

  async getUserById(id: string): Promise<IGraphEntry> {
    return new Promise<IGraphEntry>((resolve, reject) => {
      return this.getTokenThenEntity(id, null, (err, info) => {
        if (err && err['status'] === 404) {
          return resolve(null);
        } else if (err) {
          return reject(err);
        }
        return resolve(info as IGraphEntry);
      });
    });
  }

  async getManagerByIdAsync(id: string): Promise<IGraphEntry> {
    return new Promise<IGraphEntry>((resolve, reject) => {
      this.getManagerById(id, (err, info) => {
        if (err && err['status'] === 404) {
          // console.log('User not found in the directory');
          return resolve(null);
        }
        if (err) {
          return reject(err);
        }
        return resolve(info as IGraphEntry);
      });
    });
  }

  async getGroup(corporateGroupId: string): Promise<IGraphGroup> {
    const response = await this.lookupInGraph([
      'groups',
      corporateGroupId,
    ], {
      selectValues: 'description,displayName,id,mail,mailNickname',
    });
    return response;
  }

  async getGroupsByNickname(nickname: string): Promise<string[]> {
    const response = await this.lookupInGraph([
      'groups',
    ], {
      filterValues: `mailNickname eq '${encodeURIComponent(nickname)}'`,
      selectValues: 'id',
    }) as any[];
    return response.map(entry => entry.id);
  }

  async getMailAddressByUsername(corporateUsername: string): Promise<string> {
    const response = await this.lookupInGraph([
      'users',
      corporateUsername,
    ], {
      selectValues: 'mail',
    });
    return response?.mail;
  }

  async getUserIdByUsername(corporateUsername: string): Promise<string> {
    const response = await this.lookupInGraph([
      'users',
      corporateUsername,
    ], {
      selectValues: 'id',
    });
    return response?.id;
  }

  async getUserIdByNickname(nickname: string): Promise<string> {
    const response = await this.lookupInGraph([
      'users',
    ], {
      filterValues: `mailNickname eq '${encodeURIComponent(nickname)}'`,
      selectValues: 'id',
    }) as any[];
    if (!response || response.length === 0) {
      return null;
    }
    return response.map(entry => entry.id)[0];
  }

  async getGroupMembers(corporateGroupId: string): Promise<IGraphGroupMember[]> {
    const response = await this.lookupInGraph([
      'groups',
      corporateGroupId,
      'transitiveMembers', // transitiveMembers or members
    ], {
      selectValues: 'id,userPrincipalName',
    }) as any[];
    return response.map(entry => { return { id: entry.id, userPrincipalName: entry.userPrincipalName } });
  }

  async getGroupsStartingWith(minimum3Characters: string): Promise<IGraphGroup[]> {
    if (!minimum3Characters || minimum3Characters.length < 3) {
      throw new Error(`Minimum 3 characters required: ${minimum3Characters}`);
    }
    const response = await this.lookupInGraph([
      'groups',
    ], {
      filterValues: `startswith(displayName, '${minimum3Characters}') or startswith(mailNickname, '${minimum3Characters}')`,
      selectValues: 'id,displayName,mailNickname',
    }) as any[];
    return response.map(entry => { return { id: entry.id, mailNickname: entry.mailNickname, displayName: entry.displayName } });
  }

  async getGroupsByMail(groupMailAddress: string): Promise<string[]> {
    const response = await this.lookupInGraph([
      'groups',
    ], {
      filterValues: `mail eq '${groupMailAddress}'`,
      selectValues: 'id',
    }) as any[];
    return response.map(entry => entry.id);
  }

  async getGroupsById(corporateId: string): Promise<string[]> {
    const response = await this.lookupInGraph([
      'users',
      corporateId,
      'getMemberGroups',
    ], {
      // selectValues: '',
      body: {
        securityEnabledOnly: true,
      },
    }) as string[];
    return response;
  }

  private async getUserAndManagerAsync(employeeDirectoryId: string): Promise<any> {
    return new Promise<any>((resolve, reject) => {
      this.getUserAndManagerById(employeeDirectoryId, (err, info) => {
        if (err) {
          return reject(err);
        }
        return resolve(info);
      });
    });
  }

  private getGraphOptions(accessToken) {
    return {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      json: true,
    };
  }

  private async getRequestOptionsWithToken(): Promise<any> {
    const token = await this.getToken();
    return {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      json: true,
    };
  }

  private async getToken(): Promise<string> {
    return new Promise((resolve, reject) => {
      this.getTokenByCallback((error, token) => {
        return error ? reject(error) : resolve(token);
      });
    });
  }

  private getTokenByCallback(callback) {
    const tokenKey = this.clientId;
    const token = cache.get(tokenKey);
    if (token) {
      return callback(null, token);
    }
    this.getGraphAccessToken((error, t) => {
      if (error) {
        return callback(error);
      }
      cache.put(tokenKey, t, this.#_tokenCacheMilliseconds);
      return callback(null, t);
    });
  }

  private getUserByIdLookup(aadId, options, subResource, callback) {
    if (!callback && typeof (subResource) === 'function') {
      callback = subResource;
      subResource = null;
    }
    const extraPath = subResource ? `/${subResource}` : '';
    const url = `https://graph.microsoft.com/v1.0/users/${aadId}${extraPath}?$select=id,alias,userType,displayName,givenName,mail,userPrincipalName`;
    request.get(url, options, (err, response, body) => {
      if (err) {
        return callback(err, null);
      } else if (response.statusCode === 404) {
        let err404 = new Error(`user not found in the corporate directory with the ID '${aadId}'`);
        err404['status'] = 404;
        return callback(err404, null);
      } else if (response.statusCode >= 400) {
        return callback(new Error(`Invalid status code: ${response.statusCode}`), null);
      } else if (body === undefined) {
        let err404 = new Error(`user not found in the corporate directory with the ID '${aadId}'`);
        err404['status'] = 404;
        return callback(err404, null);
      } else if (body.error) {
        return callback(new Error(body.error.message), null);
      } else {
        return callback(null, body);
      }
    });
  }

  private async lookupInGraph(entityPath: string[], options: IGraphOptions): Promise<any> {
    // initial hacking on top of the API
    const subUrl = entityPath.map(item => encodeURIComponent(item)).join('/');
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
    let hasArray = false;
    let value = null;
    let url = `${graphBaseUrl}${subUrl}?${querystring.stringify(queries)}`;
    let pages = 0;
    do {
      const body = await this.request(url, options.body);
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
      ++pages;
      url = body && body[odataNextLink] ? body[odataNextLink] : null;
    } while (url);
    return value;
  }

  private async request(url: string, body?: any): Promise<any> {
    const requestOptions = await this.getRequestOptionsWithToken();
    if (body) {
      requestOptions.body = body;
    }
    requestOptions.method = body ? 'post' : 'get';
    return await new Promise((resolve, reject) => {
      request(url, requestOptions, (err, response, body) => {
        if (err) {
          return reject(err);
        } else if (response.statusCode === 404) {
          return reject(CreateError.NotFound(url));
        } else if (response.statusCode >= 400) {
          const extraMessage = body && body.error && body.error.message ? body.error.message + ' ' : '';
          const err = new Error(`${extraMessage}Response code ${response.statusCode}`);
          ErrorHelper.EnsureHasStatus(err, response.statusCode);
          return reject(err);
        } else if (body === undefined) {
          const err = new Error('Empty body');
          return reject(err);
        } else if (body.error) {
          return reject(new Error(body.error.message));
        } else {
          return resolve(body);
        }
      });
    });
  }

  private getGraphAccessToken(callback) {
    const clientId = this.clientId;
    const clientSecret = this.#_clientSecret;
    if (!clientId || !clientSecret) {
      return callback(null, new Error('The graph provider requires an AAD clientId and clientSecret.'));
    }
    const tokenEndpoint = this.#_tokenEndpoint || `https://login.microsoftonline.com/${this.#_tenantId}/oauth2/token`;
    // These are the parameters necessary for the OAuth 2.0 Client Credentials Grant Flow.
    // For more information, see Service to Service Calls Using Client Credentials (https://msdn.microsoft.com/library/azure/dn645543.aspx).
    const requestParams = {
      'grant_type': 'client_credentials',
      'client_id': clientId,
      'client_secret': clientSecret,
      'resource': 'https://graph.microsoft.com'
    };
    request.post({
      url: tokenEndpoint,
      form: requestParams
    }, function (err, response, body) {
      if (err) {
        return callback(err, null);
      }
      const parsedBody = JSON.parse(body);
      if (parsedBody.error) {
        return callback(new Error(parsedBody.error.message), null);
      } else {
        return callback(null, parsedBody.access_token);
      }
    });
  }

  private getTokenThenEntity(aadId, resource, callback) {
    this.getTokenByCallback((error, token) => {
      if (error) {
        return callback(error);
      }
      this.getUserByIdLookup(aadId, this.getGraphOptions(token), resource, callback);
    });
  }
}

export function getUserAndManager(graphProvider, employeeDirectoryId: string): Promise<any> {
  return new Promise<any>((resolve, reject) => {
    graphProvider.getUserAndManagerById(employeeDirectoryId, (err, info) => {
      if (err) {
        return reject(err);
      }
      return resolve(info);
    });
  });
}
