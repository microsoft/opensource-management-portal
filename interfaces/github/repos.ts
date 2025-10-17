//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import type { ICacheOptions, IPagedCacheOptions, IAccountBasics, IGitHubTeamBasics } from './index.js';
import type { IGitHubWebhookEnterprise } from './apps.js';
import {
  IPersonalizedUserAggregateRepositoryPermission,
  TeamRepositoryPermission,
  GraphManager,
} from '../../business/index.js';
import type { IRepositoryMetadataProvider } from '../../business/entities/repositoryMetadata/repositoryMetadataProvider.js';
import {
  GitHubPullRequestState,
  GitHubPullRequestSort,
  GitHubSortDirection,
} from '../../lib/github/collections.js';
import type { IRequestTeamPermissions } from '../../middleware/github/teamPermissions.js';
import { CreateError } from '../../lib/transitional.js';

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

export type RepositoryRuleset = {
  // many of these string values are actually enums
  id: number;
  name: string;
  source_type: string;
  source: string;
  enforcement: string;
  node_id: string;
  _links: unknown;
  created_at: string; // iso8601
  updated_at: string; // iso8601
};

export type RepositoryRulesetBypassOperator = {
  actor_id: number;
  actor_type: string;
  bypass_mode: string;
};

export type RepositoryRulesetDefinition = {
  // many of these string values are actually enums
  id: number;
  name: string;
  target: string;
  source_type: string;
  source: string;
  enforcement: string;
  bypass_actors: RepositoryRulesetBypassOperator[];
  conditions: {
    ref_name: {
      include: string[];
      exclude: string[];
    };
  };
  rules: unknown[];
  node_id: string;
  _links: unknown;
  created_at: string; // iso8601
  updated_at: string; // iso8601
};

export type RepositoryBranchAccessProtections = {
  required_signatures: {
    enabled: boolean;
  };
  allow_fork_syncing: {
    enabled: boolean;
  };
  lock_branch: {
    enabled: boolean;
  };
  required_conversation_resolution: {
    enabled: boolean;
  };
  block_creations: {
    enabled: boolean;
  };
  required_pull_request_reviews: {
    dismissal_restrictions:
      | {
          users: IAccountBasics[];
          teams: IGitHubTeamBasics[];
          apps: IGitHubWebhookEnterprise[];
        }
      | Record<string, never>;
    dismiss_stale_reviews: boolean;
    require_code_owner_reviews: boolean;
    required_approving_review_count: number;
    require_last_push_approval: boolean;
    bypass_pull_request_allowances: {
      users: IAccountBasics[];
      teams: IGitHubTeamBasics[];
      apps: IGitHubWebhookEnterprise[];
    };
  } | null;
  required_status_checks: {
    strict: boolean;
    contexts: string[];
    checks: {
      context: string;
      app_id: number;
    }[];
  } | null;
  branch?: string;
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
};

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
  Maintain = 'maintain',
  Write = 'write',
  Triage = 'triage',
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
    case GitHubCollaboratorPermissionLevel.Maintain:
      return GitHubRepositoryPermission.Maintain;
    case GitHubCollaboratorPermissionLevel.Write:
      return GitHubRepositoryPermission.Push;
    case GitHubCollaboratorPermissionLevel.Triage:
      return GitHubRepositoryPermission.Triage;
    case GitHubCollaboratorPermissionLevel.Read:
      return GitHubRepositoryPermission.Pull;
    default:
      throw CreateError.InvalidParameters(
        `Unrecognized GitHub permission value ${level}, current value cannot be translated (ConvertGitHubCollaboratorPermissionLevelToGitHubRepositoryPermission)`
      );
  }
}

export enum GitHubAdvancedSecurityFeatureState {
  Enabled = 'enabled',
  Disabled = 'disabled',
}

export type GitHubAdvancedSecurityFeatureStatusValue = {
  status: GitHubAdvancedSecurityFeatureState;
};

export type GitHubSecurityAnalysisFeatures = {
  advanced_security: GitHubAdvancedSecurityFeatureStatusValue;
  secret_scanning: GitHubAdvancedSecurityFeatureStatusValue;
  secret_scanning_push_protection: GitHubAdvancedSecurityFeatureStatusValue;
  dependabot_security_updates: GitHubAdvancedSecurityFeatureStatusValue;
  secret_scanning_validity_checks: GitHubAdvancedSecurityFeatureStatusValue;
};

export enum GitHubAccountType {
  Organization = 'Organization',
  User = 'User',
}

export type GitHubAccountWithType = {
  login: string;
  id: number;
  avatar_url: string;
  type: GitHubAccountType;
  // node_id: string;
  // url: string;
};

export type GitHubRepositoryLicense = {
  key: string;
  name: string;
  spdx_id: string;
  url: string;
  node_id: string;
};

export type GitHubRepositoryApiUrls = {
  url: string;
  forks_url: string;
  keys_url: string;
  collaborators_url: string;
  teams_url: string;
  hooks_url: string;
  issue_events_url: string;
  events_url: string;
  assignees_url: string;
  branches_url: string;
  tags_url: string;
  blobs_url: string;
  git_tags_url: string;
  git_refs_url: string;
  trees_url: string;
  statuses_url: string;
  languages_url: string;
  stargazers_url: string;
  contributors_url: string;
  subscribers_url: string;
  subscription_url: string;
  commits_url: string;
  git_commits_url: string;
  comments_url: string;
  issue_comment_url: string;
  contents_url: string;
  compare_url: string;
  merges_url: string;
  archive_url: string;
  downloads_url: string;
  issues_url: string;
  pulls_url: string;
  milestones_url: string;
  notifications_url: string;
  labels_url: string;
  releases_url: string;
  deployments_url: string;
};

export type GitHubRepositoryBaseDetails = {
  id: number;
  node_id: string;
  name: string;
  full_name: string;
  private: boolean;
  owner: GitHubAccountWithType;
  html_url: string;
  description: string;
  fork: boolean;
  // [then the API URLs]
  created_at: string;
  updated_at: string;
  pushed_at: string;
  git_url: string;
  ssh_url: string;
  clone_url: string;
  // svn_url: going away
  homepage: string | null;
  size: number;
  stargazers_count: number;
  watchers_count: number;
  language: string;
  has_issues: boolean;
  has_projects: boolean;
  has_downloads: boolean;
  has_wiki: boolean;
  has_pages: boolean;
  has_discussions: boolean;
  forks_count: number;
  archived: boolean;
  disabled: boolean;
  open_issues_count: number;
  license?: GitHubRepositoryLicense;
  allow_forking: boolean;
  is_template: boolean;
  web_commit_signoff_required: boolean;
  topics: string[];
  visibility?: GitHubRepositoryVisibility;
  forks: number;
  open_issues: number;
  watchers: number;
  default_branch: string;
  custom_properties: Record<string, string>;
  parent?: GitHubRepositoryDetails;
};

export type GitHubRepositorySettingDetails = {
  // permissions: admin / maintain / push / triage / pull
  // temp_clone_token: ...
  allow_squash_merge: boolean;
  allow_merge_commit: boolean;
  allow_rebase_merge: boolean;
  allow_auto_merge: boolean;
  delete_branch_on_merge: boolean;
  allow_update_branch: boolean;
  use_squash_pr_title_as_default: boolean;
  squash_merge_commit_message: string;
  squash_merge_commit_title: string;
  merge_commit_message: string;
  merge_commit_title: string;
  template_repository: GitHubRepositoryDetails;
  organization?: GitHubAccountWithType;
  security_and_analysis?: GitHubSecurityAnalysisFeatures;
  network_count: number;
  subscribers_count: number;
};

export type GitHubRepositoryDetails = GitHubRepositoryBaseDetails & GitHubRepositorySettingDetails;
