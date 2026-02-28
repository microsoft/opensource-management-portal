//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { Repository } from './repository.js';
import { getPageSize, getMaxAgeSeconds, CacheDefault, Operations } from './index.js';
import { AppPurpose } from '../lib/github/appPurposes.js';
import {
  PurposefulGetAuthorizationHeader,
  ICacheOptions,
  GetAuthorizationHeader,
} from '../interfaces/index.js';
import { GitHubAppPermission } from '../lib/github/types.js';

export type GitHubActionWorkflowsResponse = {
  total_count: number;
  workflows: GitHubActionWorkflow[];
};

export type GitHubActionWorkflow = {
  id: number;
  node_id: string;
  name: string;
  path: string;
  state: 'active' | 'disabled_manually' | 'disabled_inactivity'; // or ?
  created_at: string; // Date
  updated_at: string; // Date
  url: string;
  html_url: string;
  badge_url: string;
};

export type GitHubRepositorySecretMetadata = {
  name: string;
  created_at: string;
  updated_at: string;
};

export type GitHubRepositorySecretsResponse = {
  total_count: number;
  secrets: GitHubRepositorySecretMetadata[];
};

export type GitHubRepositoryVariablesResponse = {
  total_count: number;
  variables: GitHubRepositoryVariable[];
};

export type GitHubRepositoryVariable = {
  name: string;
  value: string;
  created_at: string;
  updated_at: string;
};

export type GitHubWorkflowRunsResponse = {
  total_count: number;
  workflow_runs: any[];
};

export type GitHubWorkflowRun = {
  actor: {
    // consider a type
    login: string;
    id: number;
  };
  artifacts_url: string;
  cancel_url: string;
  check_suite_id: number;
  check_suite_node_id: string;
  check_suite_url: string;
  conclusion: string; // skipped, ...
  created_at: string; // Date
  display_title: string;
  event: string; // push, ...
  head_branch: string;
  head_commit: unknown; // ... add type
  head_repository: unknown; // ... add type
  head_sha: string;
  html_url: string;
  id: number;
  jobs_url: string;
  logs_url: string;
  name: string;
  node_id: string;
  path: string;
  previous_attempt_url: string;
  pull_requests: unknown[]; // consider a type
  referenced_workflows: unknown[]; // consider a type
  repository: unknown; // consider a type
  rerun_url: string;
  run_attempt: number;
  run_number: number;
  run_started_at: string; // Date
  status: string; // completed, ...
  triggering_actor: unknown; // consider a type
  updated_at: string; // Date
  url: string;
  workflow_id: number;
  workflow_url: string;
};

export class RepositoryActions {
  private _getAuthorizationHeader: PurposefulGetAuthorizationHeader;
  // private _getSpecificAuthorizationHeader: PurposefulGetAuthorizationHeader;
  private _operations: Operations;

  private _repository: Repository;

  constructor(
    repository: Repository,
    getAuthorizationHeader: PurposefulGetAuthorizationHeader,
    getSpecificAuthorizationHeader: PurposefulGetAuthorizationHeader,
    operations: Operations
  ) {
    this._repository = repository;
    this._getAuthorizationHeader = getAuthorizationHeader;
    // this._getSpecificAuthorizationHeader = getSpecificAuthorizationHeader;
    this._operations = operations;
  }

  async getWorkflow(workflowId: number, cacheOptions?: ICacheOptions): Promise<GitHubActionWorkflow> {
    cacheOptions = cacheOptions || {};
    const operations = this._operations as Operations;
    const { github } = operations;
    const parameters = {
      owner: this._repository.organization.name,
      repo: this._repository.name,
      workflow_id: workflowId,
    };
    if (!cacheOptions.maxAgeSeconds) {
      cacheOptions.maxAgeSeconds = getMaxAgeSeconds(
        operations as Operations,
        CacheDefault.repoBranchesStaleSeconds /* not specific */
      );
    }
    if (cacheOptions.backgroundRefresh === undefined) {
      cacheOptions.backgroundRefresh = true;
    }
    const { rest } = github.octokit;
    const entity = await github.callWithRequirements(
      github.createRequirementsForFunction(
        this.authorize(AppPurpose.Security),
        rest.actions.getWorkflow,
        'actions.getWorkflow'
      ),
      parameters,
      cacheOptions
    );
    return entity as GitHubActionWorkflow;
  }

  async getRepositorySecrets(): Promise<GitHubRepositorySecretsResponse> {
    // Don't worry, the secrets are libsodium encrypted; this is just
    // metadata.
    const operations = this._operations as Operations;
    const parameters = {
      owner: this._repository.organization.name,
      repo: this._repository.name,
    };
    const { github } = operations;
    const { rest } = github.octokit;
    const entity = await github.callWithRequirements(
      github.createRequirementsForFunction(
        this.authorize(AppPurpose.Security),
        rest.actions.listRepoSecrets,
        'actions.listRepoSecrets'
      ),
      parameters
    );
    return entity;
  }

  async getRepositoryVariables(): Promise<GitHubRepositoryVariablesResponse> {
    const operations = this._operations as Operations;
    const parameters = {
      owner: this._repository.organization.name,
      repo: this._repository.name,
    };
    const { github } = operations;
    const { rest } = github.octokit;
    const entity = await github.callWithRequirements(
      github.createRequirementsForFunction(
        this.authorize(AppPurpose.Security),
        rest.actions.listRepoVariables,
        'actions.listRepoVariables',
        {
          permissions: {
            permission: 'actions_variables',
            access: GitHubAppPermission.Read,
          },
        }
      ),
      parameters
    );
    return entity;
  }

  async getWorkflows(cacheOptions?: ICacheOptions): Promise<GitHubActionWorkflowsResponse> {
    cacheOptions = cacheOptions || {};
    const operations = this._operations as Operations;
    const parameters = {
      owner: this._repository.organization.name,
      repo: this._repository.name,
      per_page: getPageSize(operations),
    };
    if (!cacheOptions.maxAgeSeconds) {
      cacheOptions.maxAgeSeconds = getMaxAgeSeconds(
        operations as Operations,
        CacheDefault.repoBranchesStaleSeconds /* not specific */
      );
    }
    if (cacheOptions.backgroundRefresh === undefined) {
      cacheOptions.backgroundRefresh = true;
    }
    const { github } = operations;
    const { rest } = github.octokit;
    const entity = await github.callWithRequirements(
      github.createRequirementsForFunction(
        this.authorize(AppPurpose.ActionsData),
        rest.actions.listRepoWorkflows,
        'actions.listRepoWorkflows',
        {
          permissions: {
            // NOTE: current Octokit data file, this is inaccurate for URL lookups
            // Likely bug in the open api specs.
            permission: 'actions',
            access: 'read',
          },
          permissionsMatchRequired: true,
        }
      ),
      parameters,
      cacheOptions
    );
    return entity as GitHubActionWorkflowsResponse;
  }

  async getWorkflowRuns(
    workflowId: string | number,
    cacheOptions?: ICacheOptions
  ): Promise<GitHubWorkflowRunsResponse> {
    cacheOptions = cacheOptions || {};
    const operations = this._operations as Operations;
    const github = operations.github;
    const parameters = {
      owner: this._repository.organization.name,
      repo: this._repository.name,
      workflow_id: String(workflowId),
    };
    if (!cacheOptions.maxAgeSeconds) {
      cacheOptions.maxAgeSeconds = getMaxAgeSeconds(
        operations as Operations,
        CacheDefault.repoBranchesStaleSeconds /* not specific */
      );
    }
    if (cacheOptions.backgroundRefresh === undefined) {
      cacheOptions.backgroundRefresh = true;
    }
    const { rest } = github.octokit;
    const entity = await github.callWithRequirements(
      github.createRequirementsForFunction(
        this.authorize(AppPurpose.ActionsData),
        rest.actions.listWorkflowRuns,
        'actions.listWorkflowRuns'
      ),
      parameters,
      cacheOptions
    );
    return entity as GitHubWorkflowRunsResponse;
  }

  async getWorkflowUsage(workflowId: string | number, cacheOptions?: ICacheOptions): Promise<any> {
    cacheOptions = cacheOptions || {};
    const operations = this._operations as Operations;
    const github = operations.github;
    const parameters = {
      owner: this._repository.organization.name,
      repo: this._repository.name,
      workflow_id: String(workflowId),
    };
    if (!cacheOptions.maxAgeSeconds) {
      cacheOptions.maxAgeSeconds = getMaxAgeSeconds(
        operations as Operations,
        CacheDefault.repoBranchesStaleSeconds /* not specific */
      );
    }
    if (cacheOptions.backgroundRefresh === undefined) {
      cacheOptions.backgroundRefresh = true;
    }
    const { rest } = github.octokit;
    const entity = await github.callWithRequirements(
      github.createRequirementsForFunction(
        this.authorize(AppPurpose.ActionsData),
        rest.actions.getWorkflowUsage,
        'actions.getWorkflowUsage'
      ),
      parameters,
      cacheOptions
    );
    return entity;
  }

  private authorize(purpose: AppPurpose): GetAuthorizationHeader | string {
    const getAuthorizationHeader = this._getAuthorizationHeader.bind(this, purpose) as GetAuthorizationHeader;
    return getAuthorizationHeader;
  }
}
