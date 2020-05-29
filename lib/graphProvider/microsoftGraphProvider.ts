//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

// This code adopted from our existing jobs code

import cache from 'memory-cache';
import request from 'request';
import { IGraphProvider, IGraphEntry, IGraphEntryWithManager } from '.';
import { ErrorHelper } from '../../transitional';

export interface IMicrosoftGraphProviderOptions {
  tokenCacheSeconds?: string | number;
  clientId: string;
  clientSecret: string;
  tokenEndpoint?: string;
  tenantId?: string;
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

  getUserById(aadId, callback) {
    this.getTokenThenEntity(aadId, null, callback);
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

  async getUserByIdAsync(id: string): Promise<IGraphEntry> {
    return new Promise<IGraphEntry>((resolve, reject) => {
      this.getUserById(id, (err, info) => {
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

  private getToken(callback) {
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
    const url = `https://graph.microsoft.com/v1.0/users/${aadId}${extraPath}?$select=id,userType,displayName,givenName,mail,userPrincipalName`;
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
    this.getToken((error, token) => {
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
