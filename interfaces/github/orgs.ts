//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import type { ICacheOptions, IPagedCacheOptions } from './index.js';
import type { ICorporateLink } from '../index.js';
import { OrganizationMember } from '../../business/index.js';
import { Repository } from '../../business/repository.js';

export interface ICreateRepositoryResult {
  response: any;
  repository: Repository;
}

export enum OrganizationMembershipState {
  Active = 'active',
  Pending = 'pending',
}

export enum OrganizationMembershipRole {
  Member = 'member',
  Admin = 'admin',
}

export enum OrganizationMembershipRoleQuery {
  Member = 'member',
  Admin = 'admin',
  All = 'all',
}

export enum OrganizationMembershipTwoFactorFilter {
  AllMembers = 'all',
  TwoFactorOff = '2fa_disabled',
}

export enum GitHubAuditLogInclude {
  Web = 'web',
  Git = 'git',
  All = 'all',
}

export interface GitHubAuditLogEntry {
  '@timestamp': number;
  _document_id: string;
  action: string;
  actor: string;
  actor_id: number;
  actor_is_bot: boolean;
  actor_location: unknown;
  business: string;
  business_id: number;
  created_at: number;
  external_identity_nameid: string; // @cspell:ignore nameid
  external_identity_username: string;
  operation_type: string;
  event: string;
  head_branch?: string;
  head_sha?: string;
  name?: string;
  org: string;
  org_id: number;
  repo: string;
  repo_id: number;
  started_at: string;
  trigger_id?: string;
  workflow_id?: number;
  workflow_run_id?: number;
  user?: string;
  user_agent: string;
}

export interface GitHubAuditLogFormattedEntryMvp {
  pretty: string;
  raw: GitHubAuditLogEntry;
}

export enum GitHubAuditLogOrder {
  Ascending = 'asc',
  Descending = 'desc',
}

export interface IGetAuditLogOptions extends ICacheOptions {
  phrase?: string;
  include?: GitHubAuditLogInclude;
  after?: string;
  before?: string;
  order?: GitHubAuditLogOrder;
  per_page?: number;
}

export type GetOrganizationMembersOptions = IPagedCacheOptions & {
  filter?: OrganizationMembershipTwoFactorFilter;
  role?: OrganizationMembershipRoleQuery;

  doNotProjectEntities?: boolean;
};

export interface IAddOrganizationMembershipOptions extends ICacheOptions {
  role?: OrganizationMembershipRole;
}

export interface IOrganizationMemberPair {
  member?: OrganizationMember;
  link?: ICorporateLink;
}

export interface IOrganizationMembership {
  state: OrganizationMembershipState;
  role: OrganizationMembershipRole;
  organization: any;
  user: any;
}

export type GitHubSimpleAccount = {
  login: string;
  avatar_url: string;
  id: number;
};

export type GitHubOrganizationEntity = GitHubSimpleAccount & {
  description: string;
  name: string;
  node_id: string;
  url: string;
};

export type GitHubOrganizationInvite = {
  created_at: string;
  email: string;
  failed_at: string;
  failed_reason: string;
  id: number;
  invitation_source: string; // 'member'
  invitation_teams_url: string;
  inviter: GitHubSimpleAccount;
  login: string;
  node_id: string;
  role: string; // 'direct_member'
  team_count: number;
};

export interface ISetOrganizationAnnouncementOptions {
  announcement: string;
  expires_at?: string;
  user_dismissible?: boolean;
}

export interface IGitHubAnnouncementBanner {
  announcement: string;
  expires_at: string | null;
  user_dismissible: boolean;
}
