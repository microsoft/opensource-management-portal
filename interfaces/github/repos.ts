//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import type { ICacheOptions, IPagedCacheOptions, IAccountBasics, IGitHubTeamBasics } from '.';
import {
  IPersonalizedUserAggregateRepositoryPermission,
  TeamRepositoryPermission,
  GraphManager,
} from '../../business';
import type { IRepositoryMetadataProvider } from '../../entities/repositoryMetadata/repositoryMetadataProvider';
import {
  GitHubPullRequestState,
  GitHubPullRequestSort,
  GitHubSortDirection,
} from '../../lib/github/collections';
import type { IRequestTeamPermissions } from '../../middleware/github/teamPermissions';

export enum GitHubRepositoryPermission {
  Pull = 'pull',
  Push = 'push',
  Admin = 'admin',
  Triage = 'triage',
  Maintain = 'maintain',

  None = '',
}

export enum RepositoryLockdownState {
  Locked = 'locked',
  Unlocked = 'unlocked',
  AdministratorLocked = 'administratorLocked',
  Deleted = 'deleted',
  ComplianceLocked = 'complianceLocked',
}

export const GitHubRepositoryPermissions = [
  GitHubRepositoryPermission.Pull,
  GitHubRepositoryPermission.Triage,
  GitHubRepositoryPermission.Push,
  GitHubRepositoryPermission.Maintain,
  GitHubRepositoryPermission.Admin,
  // NOTE: does not include 'None' which is not a real GitHub REST API value
];

export interface IInitialTeamPermission {
  permission: GitHubRepositoryPermission;
  teamId: string;
  teamName?: string;
}

export enum GitHubRepositoryVisibility {
  Public = 'public',
  Private = 'private',
  Internal = 'internal',
}

export interface IGitHubCollaboratorInvitation {
  id: string;
  permissions: GitHubRepositoryPermission;
  created_at: string; // Date
  url: string; // API url
  html_url: string; // user-facing URL
}

export interface IGetBranchesOptions extends ICacheOptions {
  protected?: boolean;
}

export interface IGetContentOptions extends ICacheOptions {
  branch?: string;
  tag?: string;
  ref?: string;
}

export enum GitHubCollaboratorAffiliationQuery {
  All = 'all',
  Outside = 'outside',
  Direct = 'direct',
}

export enum GitHubCollaboratorType {
  Outside = 'outside',
  Direct = 'direct',
}

export interface IListContributorsOptions extends IPagedCacheOptions {
  anon?: boolean;
}

export interface IGetCollaboratorsOptions extends IPagedCacheOptions {
  affiliation?: GitHubCollaboratorAffiliationQuery;
}

export interface IGitHubProtectedBranchConfiguration {
  id: string;
  pattern: string;
}

export interface IGetPullsOptions extends ICacheOptions {
  state?: GitHubPullRequestState;
  head?: string;
  base?: string;
  sort?: GitHubPullRequestSort;
  direction?: GitHubSortDirection;
}

export interface ICreateWebhookOptions {
  name?: string;
  active?: boolean;
  config?: {
    url?: string;
    content_type?: string;
    secret?: string;
    insecure_ssl?: string;
  };
  url?: string;
  events?: string[];
}

export interface IGitHubBranch {
  name: string;
  commit: {
    sha: string;
    url: string;
  };
  protected: boolean;
}

export interface IGitHubBranchDetailed {
  name: string;
  commit: {
    sha: string;
    node_id: string;
    commit: {
      author: {
        name: string;
        date: string; // iso8601
        email: string;
      };
      url: string;
      message: string;
      tree: {
        sha: string;
        url: string;
      };
      committer: {
        name: string;
        date: string;
        email: string;
      };
      verification: {
        verified: boolean;
        reason: string; // 'unsigned', ...
        signature: unknown;
        payload: unknown;
      };
      comment_count: number;
    };
    author: unknown; // basic user, avatar, id, etc.
    parents: unknown[];
    url: string;
    committer: unknown; // basic user
    protected: boolean;
    protection: {
      enabled: boolean;
      required_status_checks: {
        enforcement_level: 'non_admins' | 'admins';
        contexts: string[];
      };
    };
    protection_url: string;
  };
}

export interface IRepositoryBranchAccessProtections {
  allow_deletions: {
    enabled: boolean;
  };
  allow_force_pushes: {
    enabled: boolean;
  };
  enforce_admins: {
    enabled: boolean;
    url: string;
  };
  required_linear_history: {
    enabled: boolean;
  };
  restrictions: {
    users: IAccountBasics[];
    teams: IGitHubTeamBasics[];
    apps: unknown[];
  };
  url: string;
}

export interface ITemporaryCommandOutput {
  error?: Error;
  message?: string;
}

export interface IRepositorySearchOptions {
  pageSize?: number;
  phrase?: string;
  type?: string;
  language?: string;
  userRepos?: IPersonalizedUserAggregateRepositoryPermission[];
  teamsType?: string; // ?
  teamsSubType?: string; // ?
  specificTeamRepos?: TeamRepositoryPermission[];
  specificTeamPermissions?: IRequestTeamPermissions;
  graphManager?: GraphManager;
  repositoryMetadataProvider?: IRepositoryMetadataProvider;
  createdSince?: Date;
  metadataType?: string;
}

export enum GitHubCollaboratorPermissionLevel {
  Admin = 'admin',
  Write = 'write',
  Read = 'read',
  None = 'none',
}

export function ConvertGitHubCollaboratorPermissionLevelToGitHubRepositoryPermission(
  level: GitHubCollaboratorPermissionLevel
): GitHubRepositoryPermission {
  switch (level) {
    case GitHubCollaboratorPermissionLevel.None:
      return null;
    case GitHubCollaboratorPermissionLevel.Admin:
      return GitHubRepositoryPermission.Admin;
    case GitHubCollaboratorPermissionLevel.Write:
      return GitHubRepositoryPermission.Push;
    case GitHubCollaboratorPermissionLevel.Read:
      return GitHubRepositoryPermission.Pull;
    default:
      throw new Error(
        `ConvertGitHubCollaboratorPermissionLevelToGitHubRepositoryPermission unrecognized value ${level} cannot be translated`
      );
  }
}
