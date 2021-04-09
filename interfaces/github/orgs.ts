//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { ICacheOptions, IPagedCacheOptions } from '.';
import { ICorporateLink } from '..';
import { OrganizationMember } from '../../business';
import { Repository } from '../../business/repository';

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
  action: string;
  actor: string;
  created_at: number;
  event: string;
  head_branch?: string;
  head_sha?: string;
  name?: string;
  org: string;
  repo: string;
  started_at: string;
  trigger_id?: string;
  workflow_id?: number;
  workflow_run_id?: number;
  user?: string;
}

export interface GitHubAuditLogFormattedEntryMvp {
  pretty: string;
  raw: GitHubAuditLogEntry;
}

export enum GitHubAuditLogOrder {
  Ascending = 'asc',
  Descending = 'desc',
}

export interface IGetOrganizationAuditLogOptions extends ICacheOptions {
  phrase?: string;
  include?: GitHubAuditLogInclude;
  after?: string;
  before?: string;
  order?: GitHubAuditLogOrder;
  per_page?: number;
}

export interface IGetOrganizationMembersOptions extends IPagedCacheOptions {
  filter?: OrganizationMembershipTwoFactorFilter;
  role?: OrganizationMembershipRoleQuery;
}

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
