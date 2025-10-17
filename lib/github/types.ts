//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

// import { AppInstallation } from './appInstallation';

import type {
  GetAuthorizationHeader,
  GitHubAccountWithType,
  GitHubAppInstallationPermissions,
} from '../../interfaces/index.js';

export enum GitHubAppPermission {
  Read = 'read',
  Write = 'write',
  Admin = 'admin',
}

export type GitHubPermissionBlock = Record<string /* permission name */, GitHubAppPermission | string>;

export type GitHubPermissionDefinition = {
  access: GitHubAppPermission | string;
  permission: string;
};

export type GitHubPathPermissionDefinitionsByMethod = Record<
  string /* HttpMethod */,
  GitHubPermissionDefinition
>;

export type GitHubAppInformation = {
  client_id: string;
  id: number;
  slug: string;
  node_id: string;
  owner: GitHubAccountWithType;
  name: string;
  description: string;
  external_url: string;
  html_url: string;
  created_at: string;
  updated_at: string;
  permissions: GitHubAppInstallationPermissions;
  events: string[];
};

export type OctokitMethod<T = any> = ((params?: any) => Promise<T>) & {
  endpoint: {
    DEFAULTS: {
      baseUrl: string;
      method: string; // RequestMethod in Octokit
      url: string;
    };
  };
};

export type GitHubAppPermissionRequirement = {
  permissionName: string;
  accessName: string; // read, write,
};

export type GitHubAuthenticationRequirement<T> = {
  octokitFunction?: OctokitMethod<T>;
  octokitFunctionName?: string;

  octokitRequest?: string;

  permissions?: GitHubPermissionDefinition;
  permissionsMatchRequired?: boolean;
  usePermissionsFromAlternateUrl?: string;
};

export type GitHubAuthenticationWithRequirements = {
  authorization: string | GetAuthorizationHeader;
  requirements: GitHubAuthenticationRequirement<any>;
};

export type ComputedGitHubAuthenticationRequirements = {
  permission?: Record<string /* HttpMethod */, GitHubAppPermissionRequirement>;
  httpMethod?: string;
};

/// GitHub Actions Workflow Types
/// https://docs.github.com/en/actions/learn-github-actions/workflow-syntax-for-github-actions

export type GitHubActionsWorkflow = {
  name: string;
  on: Record<string, any> | string | string[];
  jobs: Record<string, GitHubActionsJob>;
};

export type GitHubActionsJob = {
  name?: string;
  permissions?: GitHubActionsPermissionsInterface;
  'runs-on': string | string[];
  steps: GitHubActionsStep[];
};

export type GitHubActionsStep = {
  name?: string;
  uses?: string;
  run?: string;
  with?: Record<string, any>;
  env?: Record<string, string>;
};

export type GitHubActionsPermissionsInterface = {
  actions?: GitHubActionsPermissionsOptions;
  checks?: GitHubActionsPermissionsOptions;
  contents?: GitHubActionsPermissionsOptions;
  deployments?: GitHubActionsPermissionsOptions;
  discussions?: GitHubActionsPermissionsOptions;
  'id-token'?: GitHubActionsPermissionsOptions;
  issues?: GitHubActionsPermissionsOptions;
  packages?: GitHubActionsPermissionsOptions;
  pages?: GitHubActionsPermissionsOptions;
  'pull-requests'?: GitHubActionsPermissionsOptions;
  'repository-projects'?: GitHubActionsPermissionsOptions;
  'security-events'?: GitHubActionsPermissionsOptions;
  statuses?: GitHubActionsPermissionsOptions;
};

// leaving these as lowercase as it is the format used in the workflow files
export enum GitHubActionsPermissionsOptions {
  read = 'read',
  write = 'write',
  none = 'none',
  'read-all' = 'read-all',
  'write-all' = 'write-all',
  disabled = '{}',
}
