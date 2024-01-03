//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { Repository } from './repository';
import { wrapError } from '../lib/utils';
import { AppPurpose } from '../lib/github/appPurposes';
import { CacheDefault, getMaxAgeSeconds, Operations } from '.';
import {
  IOperationsInstance,
  PurposefulGetAuthorizationHeader,
  GitHubIssueState,
  IIssueLabel,
  throwIfNotGitHubCapable,
  ICacheOptions,
  GetAuthorizationHeader,
  GitHubIssuePatchParameters,
  GitHubStateReason,
} from '../interfaces';
import { CreateError, ErrorHelper } from '../lib/transitional';

export class RepositoryIssue {
  private _operations: IOperationsInstance;
  private _getAuthorizationHeader: PurposefulGetAuthorizationHeader;

  private _number: number;
  private _repository: Repository;

  private _entity: any;

  constructor(
    repository: Repository,
    issueNumber: number,
    operations: IOperationsInstance,
    getAuthorizationHeader: PurposefulGetAuthorizationHeader,
    entity?: any
  ) {
    this._getAuthorizationHeader = getAuthorizationHeader;
    this._repository = repository;
    this._number = issueNumber;
    this._operations = operations;
    if (entity) {
      this._entity = entity;
    }
  }

  get id(): number {
    return this._entity?.id as number;
  }
  get title(): string {
    return this._entity?.title as string;
  }
  get body(): string {
    return this._entity.body as string;
  }
  get state(): GitHubIssueState {
    return this._entity?.state as GitHubIssueState;
  }
  get labels(): IIssueLabel[] {
    if (this._entity) {
      return this._entity.labels as IIssueLabel[];
    } else {
      return null;
    }
  }

  get number(): number {
    return this._number;
  }

  getEntity(): any {
    return this._entity;
  }

  get repository(): Repository {
    return this._repository;
  }

  async update(patch: GitHubIssuePatchParameters): Promise<any> {
    const operations = throwIfNotGitHubCapable(this._operations);
    const parameters = Object.assign(patch, {
      owner: this.repository.organization.name,
      repo: this.repository.name,
      issue_number: this.number,
    });
    // Operations has issue write permissions
    const details = await operations.github.post(
      this.authorize(AppPurpose.Operations),
      'issues.update',
      parameters
    );
    return details;
  }

  async close(reason: GitHubStateReason = GitHubStateReason.Completed): Promise<void> {
    await this.update({
      state: GitHubIssueState.Closed,
      state_reason: reason,
    });
  }

  async comment(commentBody: string): Promise<any> {
    const operations = throwIfNotGitHubCapable(this._operations);
    const parameters = Object.assign(
      {
        body: commentBody,
      },
      {
        owner: this.repository.organization.name,
        repo: this.repository.name,
        issue_number: this.number,
      }
    );
    // Operations has issue write permissions
    const comment = await operations.github.post(
      this.authorize(AppPurpose.Operations),
      'issues.createComment',
      parameters
    );
    return comment;
  }

  async getComment(commentId: string): Promise<any> {
    const operations = throwIfNotGitHubCapable(this._operations);
    const parameters = Object.assign({
      owner: this.repository.organization.name,
      repo: this.repository.name,
      comment_id: commentId,
    });
    const comment = await operations.github.post(
      this.authorize(AppPurpose.Operations),
      'issues.getComment',
      parameters
    );
    return comment;
  }

  async isCommentDeleted(commentId: string) {
    try {
      await this.getComment(commentId);
      return false;
    } catch (error) {
      if (ErrorHelper.IsNotFound(error)) {
        return true;
      }
      throw error;
    }
  }

  async getDetails(options?: ICacheOptions, okToUseLocalEntity = true): Promise<any> {
    if (okToUseLocalEntity && this._entity) {
      return this._entity;
    }
    options = options || {};
    const operations = throwIfNotGitHubCapable(this._operations);
    if (!this._repository.name) {
      throw new Error('repository.name required');
    }
    const parameters = {
      owner: this._repository.organization.name,
      repo: this._repository.name,
      issue_number: this._number,
    };
    const cacheOptions: ICacheOptions = {
      // NOTE: just reusing repo details stale time
      maxAgeSeconds: getMaxAgeSeconds(operations, CacheDefault.orgRepoDetailsStaleSeconds, options),
    };
    if (options.backgroundRefresh !== undefined) {
      cacheOptions.backgroundRefresh = options.backgroundRefresh;
    }
    try {
      const entity = await operations.github.call(
        this.authorize(AppPurpose.Data),
        'issues.get',
        parameters,
        cacheOptions
      );
      this._entity = entity;
      return entity;
    } catch (error) {
      const notFound = error.status && error.status == /* loose */ 404;
      error = wrapError(
        error,
        notFound ? 'The issue could not be found.' : `Could not get details about the issue. ${error.status}`,
        notFound
      );
      if (notFound) {
        error.status = 404;
      }
      throw error;
    }
  }

  async getGraphQlNodeId() {
    if (!this.getEntity()?.node_id) {
      await this.getDetails();
    }
    const { node_id: nodeId } = this.getEntity();
    return nodeId;
  }

  async isDeleted(options?: ICacheOptions): Promise<boolean> {
    try {
      await this.getDetails(options, false /* do not use local entity instance */);
    } catch (maybeDeletedError) {
      if (ErrorHelper.IsNotFound(maybeDeletedError)) {
        return true;
      }
    }
    return false;
  }

  private authorize(purpose: AppPurpose): GetAuthorizationHeader | string {
    const getAuthorizationHeader = this._getAuthorizationHeader.bind(this, purpose) as GetAuthorizationHeader;
    return getAuthorizationHeader;
  }

  static async CreateFromContentUrl(operations: IOperationsInstance, url: string) {
    const ops = operations as Operations;
    if (!ops.getRepositoryWithOrganizationFromUrl) {
      throw CreateError.ServerError(
        'The operations instance does not support returning repositories from URL'
      );
    }
    const repository = ops.getRepositoryWithOrganizationFromUrl(url);
    const response = await repository.organization.requestUrl(url);
    return repository.issue(response.number, response);
  }
}
