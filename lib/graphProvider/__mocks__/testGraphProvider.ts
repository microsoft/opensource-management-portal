//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { CreateError } from '../../transitional.js';
import { GraphUserType } from '../enums.js';
import type {
  IGraphEntry,
  IGraphEntryWithManager,
  IGraphGroup,
  IGraphGroupMember,
  IGraphProvider,
} from '../types.js';

// @cspell: ignore watercooler

const SampleDirectorySecurityGroups: IGraphGroup[] = [
  {
    displayName: 'Engineering',
    id: '1',
    mailNickname: 'engineering',
  },
  {
    displayName: 'Engineering Managers',
    id: '2',
    mailNickname: 'engineering-managers',
  },
  {
    displayName: 'Watercooler',
    id: '5',
    mailNickname: 'watercooler',
  },
];

const engineeringGroup = SampleDirectorySecurityGroups[0];
const engineeringManagersGroup = SampleDirectorySecurityGroups[1];
const watercoolerGroup = SampleDirectorySecurityGroups[2];

const SampleDirectoryUsers: IGraphEntry[] = [
  {
    displayName: 'User One',
    givenName: 'User',
    id: '1',
    mail: 'user.one@contoso.ospo.dev',
    userPrincipalName: 'user1@contoso.ospo.dev',
    userType: GraphUserType.Member,
    jobTitle: 'Engineering Manager',
  },
  {
    displayName: 'User Two',
    givenName: 'User',
    id: '2',
    mail: 'user.two@contoso.ospo.dev',
    userPrincipalName: 'user2@contoso.ospo.dev',
    userType: GraphUserType.Member,
    jobTitle: 'Software Engineer',
  },
  {
    displayName: 'The CEO',
    givenName: 'CEO',
    id: '99',
    mail: 'ceo@contoso.ospo.dev',
    userPrincipalName: 'ceo@contoso.ospo.dev',
    userType: GraphUserType.Member,
    jobTitle: 'CEO',
  },
  {
    displayName: 'An Engineer',
    givenName: 'Engineer',
    id: '3',
    mail: 'eng@contoso.ospo.dev',
    userPrincipalName: 'eng@contoso.ospo.dev',
    userType: GraphUserType.Member,
    jobTitle: 'Senior Software Engineer',
  },
];

const ceo = SampleDirectoryUsers[2];
const manager = SampleDirectoryUsers[0];
const individualContributor1 = SampleDirectoryUsers[1];
const individualContributor2 = SampleDirectoryUsers[1];

const mapUserToManager = new Map<IGraphEntry, IGraphEntry>();

mapUserToManager.set(individualContributor1, manager);
mapUserToManager.set(individualContributor2, manager);
mapUserToManager.set(manager, ceo);
mapUserToManager.set(ceo, null);

const FormerUsers: IGraphEntry[] = [
  {
    displayName: 'Former Employee',
    givenName: 'User',
    id: '9',
    mail: 'former@contoso.ospo.dev',
    userPrincipalName: 'former@contoso.ospo.dev',
    userType: GraphUserType.Member,
    jobTitle: 'Software Engineer',
  },
];

const groupMembers = new Map<IGraphGroup, IGraphEntry[]>();
groupMembers.set(engineeringGroup, [individualContributor1, individualContributor2, manager]);
groupMembers.set(engineeringManagersGroup, [manager, ceo]);
groupMembers.set(watercoolerGroup, [individualContributor1, individualContributor2]);

export class TestGraphProvider implements IGraphProvider {
  KnownUsers = SampleDirectoryUsers;
  FormerUsers = FormerUsers;
  SecurityGroups = SampleDirectorySecurityGroups;
  SpecificUserRoles = {
    CEO: ceo,
    Manager: manager,
    IndividualContributor1: individualContributor1,
  };

  async getUserById(id: string): Promise<IGraphEntry> {
    return this.KnownUsers.find((user) => user.id === id);
  }

  async getUserIdByNickname(nickname: string): Promise<string> {
    const user = this.KnownUsers.find((user) => user.mailNickname?.toLowerCase() === nickname.toLowerCase());
    return user ? user.id : null;
  }

  async getUserAndManagerById(corporateId: string): Promise<IGraphEntryWithManager> {
    const user = this.KnownUsers.find((user) => user.id === corporateId);
    const manager = mapUserToManager.get(user);
    return { ...user, manager };
  }

  async getManagerById(corporateId: string): Promise<IGraphEntry> {
    const user = this.KnownUsers.find((user) => user.id === corporateId);
    return mapUserToManager.get(user);
  }

  async getManagementChain(corporateId: string): Promise<IGraphEntry[]> {
    const user = this.KnownUsers.find((user) => user.id === corporateId);
    const chain = [];
    let current = user;
    while (current) {
      chain.push(current);
      current = mapUserToManager.get(current);
    }
    return chain;
  }

  async getDirectReports(corporateIdOrUpn: string): Promise<IGraphEntry[]> {
    const manager = this.KnownUsers.find(
      (user) =>
        user.id === corporateIdOrUpn ||
        user.userPrincipalName.toLowerCase() === corporateIdOrUpn.toLowerCase()
    );
    return this.KnownUsers.filter((user) => mapUserToManager.get(user) === manager);
  }

  async getMailAddressByUsername(corporateUsername: string): Promise<string> {
    const user = this.KnownUsers.find(
      (user) => user.userPrincipalName.toLowerCase() === corporateUsername.toLowerCase()
    );
    return user ? user.mail : null;
  }

  async getUserIdByUsername(corporateUsername: string): Promise<string> {
    const user = this.KnownUsers.find(
      (user) => user.userPrincipalName.toLowerCase() === corporateUsername.toLowerCase()
    );
    return user ? user.id : null;
  }

  async getUserIdByMail(mail: string): Promise<string> {
    const user = this.KnownUsers.find((user) => user.mail?.toLowerCase() === mail.toLowerCase());
    return user ? user.id : null;
  }

  async getUsersBySearch(minimum3Characters: string): Promise<IGraphEntry[]> {
    return this.KnownUsers.filter((user) =>
      user.displayName.toLowerCase().includes(minimum3Characters.toLowerCase())
    );
  }

  async getUsersByIds(userIds: string[]): Promise<IGraphEntry[]> {
    return this.KnownUsers.filter((user) => userIds.includes(user.id));
  }

  async getUsersByMailNicknames(mailNicknames: string[]): Promise<IGraphEntry[]> {
    return this.KnownUsers.filter((user) => mailNicknames.includes(user.mailNickname));
  }

  async getGroupsById(corporateId: string): Promise<string[]> {
    // for each group, need a map of all the corporateIds in it
    return Array.from(groupMembers.entries())
      .filter(([group, members]) => members.some((member) => member.id === corporateId))
      .map(([group]) => group.id);
  }

  async getGroupsByMail(groupMailAddress: string): Promise<string[]> {
    return Array.from(groupMembers.entries())
      .filter(([group]) => group.mail?.toLowerCase() === groupMailAddress.toLowerCase())
      .map(([group]) => group.id);
  }

  async getGroupsByNickname(nickname: string): Promise<string[]> {
    return Array.from(groupMembers.entries())
      .filter(([group]) => group.mailNickname.toLowerCase() === nickname.toLowerCase())
      .map(([group]) => group.id);
  }

  async getGroupsStartingWith(minimum3Characters: string): Promise<IGraphGroup[]> {
    return this.SecurityGroups.filter(
      (group) =>
        group.displayName.toLowerCase().includes(minimum3Characters.toLowerCase()) ||
        group.mailNickname.toLowerCase().includes(minimum3Characters.toLowerCase()) ||
        group.id === minimum3Characters
    );
  }

  async getGroupMembers(corporateGroupId: string): Promise<IGraphGroupMember[]> {
    const group = this.SecurityGroups.find((group) => group.id === corporateGroupId);
    return groupMembers.get(group);
  }

  async getGroup(corporateGroupId: string): Promise<IGraphGroup> {
    return this.SecurityGroups.find((group) => group.id === corporateGroupId);
  }

  async getUserSecurityGroups(corporateId: string): Promise<string[]> {
    return Array.from(groupMembers.entries())
      .filter(([group, members]) => members.some((member) => member.id === corporateId))
      .map(([group]) => group.id);
  }

  async isUserInGroup(corporateId: string, securityGroupId: string): Promise<boolean> {
    const group = this.SecurityGroups.find((group) => group.id === securityGroupId);
    return groupMembers.get(group).some((member) => member.id === corporateId);
  }

  getToken(): Promise<string> {
    throw CreateError.NotImplemented('The Test Graph Provider does not support tokens');
  }
}
