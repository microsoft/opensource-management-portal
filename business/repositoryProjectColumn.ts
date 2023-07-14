//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { CacheDefault, getMaxAgeSeconds, RepositoryIssue } from '.';
import { AppPurpose, AppPurposeTypes } from './githubApps';
import {
  IOperationsInstance,
  IPurposefulGetAuthorizationHeader,
  IGetAuthorizationHeader,
  ICacheOptionsWithPurpose,
  throwIfNotGitHubCapable,
  ICacheOptions,
} from '../interfaces';
import { augmentInertiaPreview, RepositoryProject } from './repositoryProject';
import { RepositoryProjectCard } from './repositoryProjectCard';
import * as common from './common';
import { CreateError } from '../transitional';

export class RepositoryProjectColumn {
  private _operations: IOperationsInstance;
  private _getSpecificAuthorizationHeader: IPurposefulGetAuthorizationHeader;

  private _id: number;
  private _project: RepositoryProject;

  private _entity: any;

  constructor(
    project: RepositoryProject,
    columnId: number,
    operations: IOperationsInstance,
    getSpecificAuthorizationHeader: IPurposefulGetAuthorizationHeader,
    entity?: any
  ) {
    this._getSpecificAuthorizationHeader = getSpecificAuthorizationHeader;
    this._project = project;
    this._id = columnId;
    this._operations = operations;
    if (entity) {
      this._entity = entity;
    }
  }

  get id(): number {
    return this._entity?.id as number;
  }
  get name(): string {
    return this._entity?.name as string;
  }
  get created_at(): Date {
    return this._entity?.created_at ? new Date(this._entity.created_at) : null;
  }
  get updated_at(): Date {
    return this._entity?.created_at ? new Date(this._entity.updated_at) : null;
  }

  getEntity(): any {
    return this._entity;
  }

  get project(): RepositoryProject {
    return this._project;
  }

  async getCards(options?: ICacheOptionsWithPurpose): Promise<RepositoryProjectCard[]> {
    options = options || {};
    const operations = throwIfNotGitHubCapable(this._operations);
    const parameters = Object.assign({
      column_id: this._id,
    });
    augmentInertiaPreview(parameters);
    const purpose = options?.purpose || AppPurpose.Data;
    const cacheOptions: ICacheOptions = {
      maxAgeSeconds: getMaxAgeSeconds(operations, CacheDefault.orgRepoDetailsStaleSeconds, options),
    };
    if (options.backgroundRefresh !== undefined) {
      cacheOptions.backgroundRefresh = options.backgroundRefresh;
    }
    // NOTE: this will not retrieve more than a few cards since we are not paging (by design); GH default is 30 anyway.
    const raw = await operations.github.call(
      this.authorizeSpecificPurpose(purpose),
      'projects.listCards',
      parameters
    );
    const cards = common.createInstances<RepositoryProjectCard>(this, projectCardFromEntity, raw);
    return cards;
  }

  async createNote(note: string): Promise<RepositoryProjectCard> {
    const operations = throwIfNotGitHubCapable(this._operations);
    const parameters = {
      column_id: String(this.id),
      note,
    };
    augmentInertiaPreview(parameters);
    const details = await operations.github.post(
      this.authorizeSpecificPurpose(AppPurpose.Operations),
      'projects.createCard',
      parameters
    );
    const card = new RepositoryProjectCard(
      this,
      details.number,
      operations,
      this._getSpecificAuthorizationHeader,
      details
    );
    return card;
  }

  async addIssue(issue: RepositoryIssue): Promise<RepositoryProjectCard> {
    const operations = throwIfNotGitHubCapable(this._operations);
    if (!issue?.id) {
      throw CreateError.InvalidParameters('The source issue does not have an ID');
    }
    const parameters = {
      column_id: String(this.id),
      content_type: 'Issue',
      content_id: issue.id,
    };
    augmentInertiaPreview(parameters);
    const details = await operations.github.post(
      this.authorizeSpecificPurpose(AppPurpose.Operations),
      'projects.createCard',
      parameters
    );
    const card = new RepositoryProjectCard(
      this,
      details.number,
      operations,
      this._getSpecificAuthorizationHeader,
      details
    );
    return card;
  }

  private authorizeSpecificPurpose(purpose: AppPurposeTypes): IGetAuthorizationHeader | string {
    const getAuthorizationHeader = this._getSpecificAuthorizationHeader.bind(
      this,
      purpose
    ) as IGetAuthorizationHeader;
    return getAuthorizationHeader;
  }
}

function projectCardFromEntity(entity) {
  // 'this' is bound for this function to be a private method
  const operations = this._operations;
  const column = new RepositoryProjectCard(
    this,
    entity.number,
    operations,
    this._getSpecificAuthorizationHeader,
    entity
  );
  return column;
}
