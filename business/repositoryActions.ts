//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { Repository } from './repository';
import { getPageSize, getMaxAgeSeconds, CacheDefault } from '.';
import { AppPurpose } from '../lib/github/appPurposes';
import {
  PurposefulGetAuthorizationHeader,
  IOperationsInstance,
  throwIfNotGitHubCapable,
  ICacheOptions,
  GetAuthorizationHeader,
} from '../interfaces';

export interface IGitHubActionWorkflowsResponse {
  total_count: number;
  workflows: IGitHubActionWorkflow[];
}

export interface IGitHubActionWorkflow {
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
}

export class RepositoryActions {
  private _getAuthorizationHeader: PurposefulGetAuthorizationHeader;
  private _getSpecificAuthorizationHeader: PurposefulGetAuthorizationHeader;
  private _operations: IOperationsInstance;

  private _repository: Repository;

  constructor(
    repository: Repository,
    getAuthorizationHeader: PurposefulGetAuthorizationHeader,
    getSpecificAuthorizationHeader: PurposefulGetAuthorizationHeader,
    operations: IOperationsInstance
  ) {
    this._repository = repository;
    this._getAuthorizationHeader = getAuthorizationHeader;
    this._getSpecificAuthorizationHeader = getSpecificAuthorizationHeader;
    this._operations = operations;
  }

  async getWorkflow(workflowId: number, cacheOptions?: ICacheOptions): Promise<IGitHubActionWorkflow> {
    cacheOptions = cacheOptions || {};
    const operations = throwIfNotGitHubCapable(this._operations);
    const github = operations.github;
    const parameters = {
      owner: this._repository.organization.name,
      repo: this._repository.name,
      workflow_id: workflowId,
    };
    if (!cacheOptions.maxAgeSeconds) {
      cacheOptions.maxAgeSeconds = getMaxAgeSeconds(
        operations,
        CacheDefault.repoBranchesStaleSeconds /* not specific */
      );
    }
    if (cacheOptions.backgroundRefresh === undefined) {
      cacheOptions.backgroundRefresh = true;
    }
    const entity = await github.call(
      this.authorize(AppPurpose.Security),
      'actions.getWorkflow',
      parameters,
      cacheOptions
    );
    return entity as IGitHubActionWorkflow;
  }

  async getRepositorySecrets(): Promise<any> {
    const operations = throwIfNotGitHubCapable(this._operations);
    const github = operations.github;
    const parameters = {
      owner: this._repository.organization.name,
      repo: this._repository.name,
    };
    const entity = await github.post(
      this.authorize(AppPurpose.Security),
      'actions.listRepoSecrets',
      parameters
    );
    return entity;
  }

  async getWorkflows(cacheOptions?: ICacheOptions): Promise<IGitHubActionWorkflowsResponse> {
    cacheOptions = cacheOptions || {};
    const operations = throwIfNotGitHubCapable(this._operations);
    const github = operations.github;
    const parameters = {
      owner: this._repository.organization.name,
      repo: this._repository.name,
      per_page: getPageSize(operations),
    };
    if (!cacheOptions.maxAgeSeconds) {
      cacheOptions.maxAgeSeconds = getMaxAgeSeconds(
        operations,
        CacheDefault.repoBranchesStaleSeconds /* not specific */
      );
    }
    if (cacheOptions.backgroundRefresh === undefined) {
      cacheOptions.backgroundRefresh = true;
    }
    // was: AppPurpose.Security before adding this newer app type
    const entity = await github.call(
      this.authorize(AppPurpose.ActionsData),
      'actions.listRepoWorkflows',
      parameters,
      cacheOptions
    );
    return entity as IGitHubActionWorkflowsResponse;
  }

  async getWorkflowRuns(workflowId: string | number, cacheOptions?: ICacheOptions): Promise<any> {
    cacheOptions = cacheOptions || {};
    const operations = throwIfNotGitHubCapable(this._operations);
    const github = operations.github;
    const parameters = {
      owner: this._repository.organization.name,
      repo: this._repository.name,
      workflow_id: String(workflowId),
    };
    if (!cacheOptions.maxAgeSeconds) {
      cacheOptions.maxAgeSeconds = getMaxAgeSeconds(
        operations,
        CacheDefault.repoBranchesStaleSeconds /* not specific */
      );
    }
    if (cacheOptions.backgroundRefresh === undefined) {
      cacheOptions.backgroundRefresh = true;
    }
    const entity = await github.call(
      this.authorize(AppPurpose.ActionsData),
      'actions.listWorkflowRuns',
      parameters,
      cacheOptions
    );
    return entity;
  }

  async getWorkflowUsage(workflowId: string | number, cacheOptions?: ICacheOptions): Promise<any> {
    cacheOptions = cacheOptions || {};
    const operations = throwIfNotGitHubCapable(this._operations);
    const github = operations.github;
    const parameters = {
      owner: this._repository.organization.name,
      repo: this._repository.name,
      workflow_id: String(workflowId),
    };
    if (!cacheOptions.maxAgeSeconds) {
      cacheOptions.maxAgeSeconds = getMaxAgeSeconds(
        operations,
        CacheDefault.repoBranchesStaleSeconds /* not specific */
      );
    }
    if (cacheOptions.backgroundRefresh === undefined) {
      cacheOptions.backgroundRefresh = true;
    }
    const entity = await github.call(
      this.authorize(AppPurpose.ActionsData),
      'actions.getWorkflowUsage',
      parameters,
      cacheOptions
    );
    return entity;
  }

  private authorize(purpose: AppPurpose): GetAuthorizationHeader | string {
    const getAuthorizationHeader = this._getSpecificAuthorizationHeader.bind(
      this,
      purpose
    ) as GetAuthorizationHeader;
    return getAuthorizationHeader;
  }
}
