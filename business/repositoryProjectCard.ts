//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { AppPurpose } from './githubApps';
import {
  IOperationsInstance,
  IPurposefulGetAuthorizationHeader,
  IGetAuthorizationHeader,
} from '../interfaces';
import { RepositoryProjectColumn } from './repositoryProjectColumn';

export class RepositoryProjectCard {
  private _operations: IOperationsInstance;
  private _getAuthorizationHeader: IPurposefulGetAuthorizationHeader;

  private _id: number;
  private _column: RepositoryProjectColumn;

  private _entity: any;

  constructor(
    column: RepositoryProjectColumn,
    cardId: number,
    operations: IOperationsInstance,
    getAuthorizationHeader: IPurposefulGetAuthorizationHeader,
    entity?: any
  ) {
    this._getAuthorizationHeader = getAuthorizationHeader;
    this._column = column;
    this._id = cardId;
    this._operations = operations;
    if (entity) {
      this._entity = entity;
    }
  }

  get id(): number {
    return this._entity?.id as number;
  }
  get note(): string {
    return this._entity?.note as string;
  }
  get archived(): boolean {
    return this._entity?.archived as boolean;
  }
  get contentUrl(): string {
    return this._entity?.content_url as string;
  }
  get createdAt(): Date {
    return this._entity?.created_at ? new Date(this._entity.created_at) : null;
  }
  get updatedAt(): Date {
    return this._entity?.created_at ? new Date(this._entity.updated_at) : null;
  }
  // creator: login, id, ...

  getEntity(): any {
    return this._entity;
  }

  get column() {
    return this._column;
  }

  private authorize(purpose: AppPurpose): IGetAuthorizationHeader | string {
    const getAuthorizationHeader = this._getAuthorizationHeader.bind(
      this,
      purpose
    ) as IGetAuthorizationHeader;
    return getAuthorizationHeader;
  }

  static HasAttachedIssue(card: RepositoryProjectCard) {
    return card.contentUrl?.includes('issues');
  }
}
