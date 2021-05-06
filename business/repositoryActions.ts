//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { Repository } from './repository';
import { getPageSize, getMaxAgeSeconds, CacheDefault } from '.';
import { AppPurpose } from '../github';
import { IPurposefulGetAuthorizationHeader, IOperationsInstance, IGetBranchesOptions, IGitHubBranch, throwIfNotGitHubCapable, IGetPullsOptions, ICacheOptions, IGetAuthorizationHeader } from '../interfaces';

export class RepositoryActions {
  private _getAuthorizationHeader: IPurposefulGetAuthorizationHeader;
  private _getSpecificAuthorizationHeader: IPurposefulGetAuthorizationHeader;
  private _operations: IOperationsInstance;

  private _repository: Repository;

  constructor(repository: Repository, getAuthorizationHeader: IPurposefulGetAuthorizationHeader, getSpecificAuthorizationHeader: IPurposefulGetAuthorizationHeader, operations: IOperationsInstance) {
    this._repository = repository;
    this._getAuthorizationHeader = getAuthorizationHeader;
    this._getSpecificAuthorizationHeader = getSpecificAuthorizationHeader;
    this._operations = operations;
  }

  async getWorkflow(workflowId: number, cacheOptions?: ICacheOptions): Promise<any> {
    cacheOptions = cacheOptions || {};
    const operations = throwIfNotGitHubCapable(this._operations);
    const github = operations.github;
    const parameters = {
      owner: this._repository.organization.name,
      repo: this._repository.name,
      workflow_id: workflowId,
    };
    if (!cacheOptions.maxAgeSeconds) {
      cacheOptions.maxAgeSeconds = getMaxAgeSeconds(operations, CacheDefault.repoBranchesStaleSeconds /* not specific */);
    }
    if (cacheOptions.backgroundRefresh === undefined) {
      cacheOptions.backgroundRefresh = true;
    }
    const entity = await github.call(this.authorize(AppPurpose.Security), 'actions.getWorkflow', parameters, cacheOptions);
    return entity;
  }

  async getRepositorySecrets(): Promise<any> {
    const operations = throwIfNotGitHubCapable(this._operations);
    const github = operations.github;
    const parameters = {
      owner: this._repository.organization.name,
      repo: this._repository.name,
    };
    const entity = await github.post(this.authorize(AppPurpose.Security), 'actions.listRepoSecrets', parameters);
    return entity;
  }

  async getWorkflows(cacheOptions?: ICacheOptions): Promise<any> {
    cacheOptions = cacheOptions || {};
    const operations = throwIfNotGitHubCapable(this._operations);
    const github = operations.github;
    const parameters = {
      owner: this._repository.organization.name,
      repo: this._repository.name,
      per_page: getPageSize(operations),
    };
    if (!cacheOptions.maxAgeSeconds) {
      cacheOptions.maxAgeSeconds = getMaxAgeSeconds(operations, CacheDefault.repoBranchesStaleSeconds /* not specific */);
    }
    if (cacheOptions.backgroundRefresh === undefined) {
      cacheOptions.backgroundRefresh = true;
    }
    const entity = await github.call(this.authorize(AppPurpose.Security), 'actions.listRepoWorkflows', parameters, cacheOptions);
    return entity;
  }

  private authorize(purpose: AppPurpose): IGetAuthorizationHeader | string {
    const getAuthorizationHeader = this._getSpecificAuthorizationHeader.bind(this, purpose) as IGetAuthorizationHeader;
    return getAuthorizationHeader;
  }
}
