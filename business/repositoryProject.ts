//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { Repository } from './repository';
import { wrapError } from '../utils';
import { AppPurpose, AppPurposeTypes } from './githubApps';
import { CacheDefault, getMaxAgeSeconds } from '.';
import {
  IOperationsInstance,
  IPurposefulGetAuthorizationHeader,
  GitHubIssueState,
  throwIfNotGitHubCapable,
  ICacheOptions,
  IGetAuthorizationHeader,
  ICacheOptionsWithPurpose,
} from '../interfaces';
import { ErrorHelper } from '../transitional';
import { RepositoryProjectColumn } from './repositoryProjectColumn';
import * as common from './common';

export class RepositoryProject {
  private _operations: IOperationsInstance;
  private _getAuthorizationHeader: IPurposefulGetAuthorizationHeader;
  private _getSpecificAuthorizationHeader: IPurposefulGetAuthorizationHeader;

  private _id: number;
  private _repository: Repository;

  private _entity: any;

  private _purpose: AppPurpose;

  constructor(
    repository: Repository,
    projectId: number,
    operations: IOperationsInstance,
    getAuthorizationHeader: IPurposefulGetAuthorizationHeader,
    getSpecificAuthorizationHeader: IPurposefulGetAuthorizationHeader,
    entity?: any
  ) {
    this._getAuthorizationHeader = getAuthorizationHeader;
    this._getSpecificAuthorizationHeader = getSpecificAuthorizationHeader;
    this._repository = repository;
    this._id = projectId;
    this._operations = operations;
    if (entity) {
      this._entity = entity;
    }
    this._purpose = AppPurpose.Operations;
    // this.overrideDefaultAppPurpose(AppPurpose.Onboarding);
  }

  overrideDefaultAppPurpose(purpose: AppPurpose) {
    this._purpose = purpose;
  }

  get id(): number {
    return this._entity?.id as number;
  }
  get name(): string {
    return this._entity?.name as string;
  }
  get body(): string {
    return this._entity?.body as string;
  }
  get private(): boolean {
    return this._entity?.private as boolean;
  }
  get state(): GitHubIssueState {
    return this._entity?.state as GitHubIssueState;
  }
  get htmlUrl(): string {
    return this._entity?.html_url as string;
  }

  getEntity(): any {
    return this._entity;
  }

  get repository(): Repository {
    return this._repository;
  }

  async update(patch: any): Promise<any> {
    const operations = throwIfNotGitHubCapable(this._operations);
    const parameters = Object.assign(patch, {
      project_id: this.id,
    });
    const details = await operations.github.post(
      this.authorizeSpecificPurpose(this._purpose),
      'projects.update',
      parameters
    );
    return details;
  }

  async delete(): Promise<boolean> {
    const operations = throwIfNotGitHubCapable(this._operations);
    const parameters = {
      project_id: this.id,
    };
    augmentInertiaPreview(parameters);
    await operations.github.post(this.authorizeSpecificPurpose(this._purpose), 'projects.delete', parameters);
    return true;
  }

  async createColumn(name: string): Promise<RepositoryProjectColumn> {
    const operations = throwIfNotGitHubCapable(this._operations);
    const parameters = {
      project_id: String(this.id),
      name,
    };
    augmentInertiaPreview(parameters);
    const details = await operations.github.post(
      this.authorizeSpecificPurpose(AppPurpose.Operations),
      'projects.createColumn',
      parameters
    );
    const column = new RepositoryProjectColumn(
      this,
      details.number,
      operations,
      this._getAuthorizationHeader,
      details
    );
    return column;
  }

  async getColumns(options?: ICacheOptionsWithPurpose): Promise<RepositoryProjectColumn[]> {
    options = options || {};
    const operations = throwIfNotGitHubCapable(this._operations);
    const parameters = Object.assign({
      project_id: this._id,
    });
    augmentInertiaPreview(parameters);
    const purpose = options?.purpose || this._purpose;
    const cacheOptions: ICacheOptions = {
      maxAgeSeconds: getMaxAgeSeconds(operations, CacheDefault.orgRepoDetailsStaleSeconds, options),
    };
    if (options.backgroundRefresh !== undefined) {
      cacheOptions.backgroundRefresh = options.backgroundRefresh;
    }
    // NOTE: this will not retrieve more than a few columns since we are not paging (by design); GH default is 30 anyway.
    const raw = await operations.github.call(
      this.authorizeSpecificPurpose(purpose),
      'projects.listColumns',
      parameters
    );
    const columns = common.createInstances<RepositoryProjectColumn>(this, projectColumnFromEntity, raw);
    return columns;
  }

  // async getColumn(columnId: number): Promise<any> {
  // }

  async getDetails(options?: ICacheOptionsWithPurpose, okToUseLocalEntity = true): Promise<any> {
    if (okToUseLocalEntity && this._entity) {
      return this._entity;
    }
    options = options || {};
    const operations = throwIfNotGitHubCapable(this._operations);
    if (!this._id) {
      throw new Error('project.id required');
    }
    const parameters = {
      project_id: this._id,
    };
    augmentInertiaPreview(parameters);
    const purpose = options?.purpose || this._purpose;
    const cacheOptions: ICacheOptions = {
      // NOTE: just reusing repo details stale time
      maxAgeSeconds: getMaxAgeSeconds(operations, CacheDefault.orgRepoDetailsStaleSeconds, options),
    };
    if (options.backgroundRefresh !== undefined) {
      cacheOptions.backgroundRefresh = options.backgroundRefresh;
    }
    try {
      const entity = await operations.github.call(
        this.authorizeSpecificPurpose(purpose),
        'projects.get',
        parameters,
        cacheOptions
      );
      this._entity = entity;
      return entity;
    } catch (error) {
      const notFound = error.status && error.status == /* loose */ 404;
      error = wrapError(
        error,
        notFound
          ? 'The project could not be found.'
          : `Could not get details about the project. ${error.status}`,
        notFound
      );
      if (notFound) {
        error.status = 404;
      }
      throw error;
    }
  }

  async isDeleted(options?: ICacheOptions): Promise<boolean> {
    try {
      await this.getDetails(options, false /* do not use local entity instance */);
    } catch (maybeDeletedError) {
      if (ErrorHelper.IsNotFound(maybeDeletedError)) {
        return true;
      }
      throw maybeDeletedError;
    }
    return false;
  }

  private authorizeSpecificPurpose(purpose: AppPurposeTypes): IGetAuthorizationHeader | string {
    const getAuthorizationHeader = this._getSpecificAuthorizationHeader.bind(
      this,
      purpose
    ) as IGetAuthorizationHeader;
    return getAuthorizationHeader;
  }
}

function projectColumnFromEntity(entity) {
  // 'this' is bound for this function to be a private method
  const operations = this._operations;
  const column = new RepositoryProjectColumn(
    this,
    entity.id,
    operations,
    this._getSpecificAuthorizationHeader,
    entity
  );
  return column;
}

export function augmentInertiaPreview(parameters: any) {
  (parameters as any).mediaType = {
    previews: ['inertia'],
  };
}
