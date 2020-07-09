//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

import { MicrosoftGraphProvider } from "./microsoftGraphProvider";

export enum GraphUserType {
  Unknown = '',
  Guest = 'Guest',
}

export interface IGraphEntry {
  displayName: string;
  givenName: string;
  id: string;
  mail: string;
  userPrincipalName: string;
  userType?: GraphUserType;
}

export interface IGraphGroupMember {
  id: string;
  userPrincipalName: string;
}

export interface IGraphGroup {
  id: string;
  displayName: string;
  mailNickname: string;

  description?: string;
  mail?: string;
}

export interface IGraphEntryWithManager extends IGraphEntry {
  manager: IGraphEntry;
}

export interface IGraphProvider {
  getUserById(corporateId: string, callback);
  getUserByIdAsync(id: string) : Promise<IGraphEntry>;

  getManagerById(corporateId: string, callback);
  getManagerByIdAsync(id: string) : Promise<IGraphEntry>;
  getUserAndManagerById(corporateId: string, callback);
  getManagementChain(corporateId: string): Promise<IGraphEntry[]>;
  getUserIdByNickname(nickname: string): Promise<string>;

  getGroupsById(corporateId: string): Promise<string[]>;
  getGroupsByMail(mailAddress: string): Promise<string[]>;
  getGroupsByNickname(nickname: string): Promise<string[]>;
  getGroupsStartingWith(minimum3Characters: string): Promise<IGraphGroup[]>;
  getGroupMembers(corporateGroupId: string): Promise<IGraphGroupMember[]>;
  getGroup(corporateGroupId: string): Promise<IGraphGroup>;
}

export function CreateGraphProviderInstance(config, callback) {
  const activeDirectoryConfig = config.activeDirectory;
  const graphConfig = Object.assign({
    tenantId: activeDirectoryConfig.tenantId,
  }, config.graph);
  if (!graphConfig) {
    return callback(new Error('No graph provider configuration.'));
  }
  const provider = graphConfig.provider;
  if (!provider) {
    return callback(new Error('No graph provider set in the graph config.'));
  }
  let providerInstance: IGraphProvider = null;
  try {
    switch (provider) {
      case 'microsoftGraphProvider':
        providerInstance = new MicrosoftGraphProvider(graphConfig);
        break;
      default:
        break;
    }
  } catch (createError) {
    return callback(createError);
  }

  if (!providerInstance) {
    return callback(new Error(`The graph provider "${provider}" is not implemented or configured at this time.`));
  }

  return callback(null, providerInstance);
};

export function getUserAndManagerById(graphProvider: IGraphProvider, aadId: string) : Promise<IGraphEntryWithManager> {
  return new Promise((resolve, reject) => {
    if (!graphProvider || !aadId) {
      return resolve();
    }
    graphProvider.getUserAndManagerById(aadId, (error, info) => {
      return error ? reject(error) : resolve(info);
    });
  });
}
