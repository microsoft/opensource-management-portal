//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { GraphUserType } from './enums.js';

export interface IGraphEntry {
  displayName: string;
  givenName: string;
  id: string;
  mail: string;
  userPrincipalName: string;
  userType?: GraphUserType;
  mailNickname?: string;
  jobTitle?: string;
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
  getUserById(id: string): Promise<IGraphEntry>;

  getUserIdByNickname(nickname: string): Promise<string>;

  getUserAndManagerById(corporateId: string): Promise<IGraphEntryWithManager>;

  getManagerById(corporateId: string): Promise<IGraphEntry>;
  getManagementChain(corporateId: string): Promise<IGraphEntry[]>;

  getDirectReports(corporateIdOrUpn: string): Promise<IGraphEntry[]>;

  getMailAddressByUsername(corporateUsername: string): Promise<string>;
  getUserIdByUsername(corporateUsername: string): Promise<string>;
  getUserIdByMail(mail: string): Promise<string>;

  getUsersBySearch(minimum3Characters: string): Promise<IGraphEntry[]>;
  getUsersByIds(userIds: string[]): Promise<IGraphEntry[]>;
  getUsersByMailNicknames(mailNicknames: string[]): Promise<IGraphEntry[]>;

  getGroupsById(corporateId: string): Promise<string[]>;
  getGroupsByMail(mailAddress: string): Promise<string[]>;
  getGroupsByNickname(nickname: string): Promise<string[]>;
  getGroupsStartingWith(minimum3Characters: string): Promise<IGraphGroup[]>;
  getGroupMembers(corporateGroupId: string): Promise<IGraphGroupMember[]>;
  getGroup(corporateGroupId: string): Promise<IGraphGroup>;
  isUserInGroup(corporateId: string, securityGroupId: string): Promise<boolean>;
  getUserSecurityGroups(corporateId: string): Promise<string[]>;

  getToken(): Promise<string>;
}
