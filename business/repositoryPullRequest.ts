//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { Repository } from './repository';
import { wrapError } from '../lib/utils';
import { AppPurpose } from '../lib/github/appPurposes';
import { CacheDefault, getMaxAgeSeconds } from '.';
import {
  IOperationsInstance,
  PurposefulGetAuthorizationHeader,
  GitHubIssueState,
  IIssueLabel,
  throwIfNotGitHubCapable,
  ICacheOptions,
  GetAuthorizationHeader,
} from '../interfaces';
import { ErrorHelper } from '../lib/transitional';

// Pull requests are issues but not all issues are pull requests. So this is mostly a clone of repositoryIssue.ts
// right now, with slightly different endpoints.

export class RepositoryPullRequest {
  private _operations: IOperationsInstance;
  private _getAuthorizationHeader: PurposefulGetAuthorizationHeader;

  private _number: number;
  private _repository: Repository;

  private _entity: any;

  constructor(
    repository: Repository,
    pullRequestNumber: number,
    operations: IOperationsInstance,
    getAuthorizationHeader: PurposefulGetAuthorizationHeader,
    entity?: any
  ) {
    this._getAuthorizationHeader = getAuthorizationHeader;
    this._repository = repository;
    this._number = pullRequestNumber;
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

  async update(patch: any): Promise<any> {
    const operations = throwIfNotGitHubCapable(this._operations);
    const parameters = Object.assign(patch, {
      owner: this.repository.organization.name,
      repo: this.repository.name,
      issue_number: this.number,
    });
    // Operations has issue write permissions
    const details = await operations.github.post(
      this.authorize(AppPurpose.Operations),
      'pulls.update',
      parameters
    );
    return details;
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
      'pulls.getReviewComment',
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

  async getReview(reviewId: string): Promise<any> {
    const operations = throwIfNotGitHubCapable(this._operations);
    const parameters = Object.assign({
      owner: this.repository.organization.name,
      repo: this.repository.name,
      pull_number: this.number,
      review_id: reviewId,
    });
    const comment = await operations.github.post(
      this.authorize(AppPurpose.Operations),
      'pulls.getReview',
      parameters
    );
    return comment;
  }

  async isReviewDeleted(reviewId: string) {
    try {
      await this.getReview(reviewId);
      return false;
    } catch (error) {
      if (ErrorHelper.IsNotFound(error)) {
        return true;
      }
      throw error;
    }
  }

  // async comment(commentBody: string): Promise<any> {
  //   const operations = throwIfNotGitHubCapable(this._operations);
  //   const parameters = Object.assign({
  //     body: commentBody,
  //   }, {
  //     owner: this.repository.organization.name,
  //     repo: this.repository.name,
  //     issue_number: this.number,
  //   });
  //   // Operations has issue write permissions
  //   const comment = await operations.github.post(this.authorize(AppPurpose.Operations), 'issues.createComment', parameters);
  //   return comment;
  // }

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
      pull_number: this._number,
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
        'pulls.get',
        parameters,
        cacheOptions
      );
      this._entity = entity;
      return entity;
    } catch (error) {
      const notFound = error.status && error.status == /* loose */ 404;
      error = wrapError(
        error,
        notFound ? 'The PR could not be found.' : `Could not get details about the PR. ${error.status}`,
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

  private authorize(purpose: AppPurpose): GetAuthorizationHeader | string {
    const getAuthorizationHeader = this._getAuthorizationHeader.bind(this, purpose) as GetAuthorizationHeader;
    return getAuthorizationHeader;
  }
}
