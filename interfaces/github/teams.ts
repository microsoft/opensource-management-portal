//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { OrganizationMembershipState } from '.';
import { ICacheOptions, ICacheOptionsPageLimiter, IPagedCrossOrganizationCacheOptions } from './rest';

export enum RequestTeamMemberAddType {
  Member = 'member',
  Maintainer = 'maintainer',
}

export enum GitHubTeamPrivacy {
  Closed = 'closed',
  Secret = 'secret',
}

export interface IGitHubTeamBasics {
  id: number;
  name: string;
  slug: string;
}

export enum GitHubTeamNotificationSetting {
  Enabled = 'notification_enabled',
  Disabled = 'notification_disabled',
}

export type GitHubTeamDetails = IGitHubTeamBasics & {
  node_id: string;
  description: string;
  privacy: GitHubTeamPrivacy;
  notification_setting: GitHubTeamNotificationSetting;
  url: string;
  html_url: string;
  members_url: string;
  repositories_url: string;
  // permission: ...
  created_at: string;
  updated_at: string;
  members_count: number;
  repos_count: number;
  // organization: ...
  parent: IGitHubTeamBasics;
};

export enum GitHubRepositoryType {
  Sources = 'sources',
}

export enum TeamJsonFormat {
  Simple, // basics
  Detailed, // full entity
  Augmented, // entity + corporate configuration layer
}

export interface ICheckRepositoryPermissionOptions extends ICacheOptions {
  organizationName?: string;
}

export interface IGetTeamRepositoriesOptions extends ICacheOptionsPageLimiter {
  type?: GitHubRepositoryType;
}

export interface ITeamMembershipRoleState {
  role?: GitHubTeamRole;
  state?: OrganizationMembershipState;
}

export interface IIsMemberOptions extends ICacheOptions {
  role?: GitHubTeamRole;
}

export interface IGetMembersOptions extends ICacheOptionsPageLimiter {
  role?: GitHubTeamRole;
}

export enum GitHubTeamRole {
  Member = 'member',
  Maintainer = 'maintainer',
}

export interface ICrossOrganizationTeamMembership extends IPagedCrossOrganizationCacheOptions {
  role?: GitHubTeamRole;
}

export interface ITeamMembershipOptions {
  role?: GitHubTeamRole;
}

export interface IUpdateTeamMembershipOptions extends ICacheOptions {
  role?: GitHubTeamRole;
}
