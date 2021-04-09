//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { IPagedCacheOptions } from '.';
import { GitHubSortDirection } from '../../lib/github/collections';

export enum GetIssuesSort {
  Created = 'created',
  Updated = 'updated',
  Comments = 'comments',
}

export enum GitHubIssueState {
  Closed = 'closed',
  Open = 'open',
}

export enum GitHubIssueQuery {
  Closed = 'closed',
  Open = 'open',
  All = 'all',
}

export interface IIssueLabel {
  id: number;
  node_id: string;
  // url: string;
  name: string;
  description?: string;
  color?: string;
  default?: boolean;
}

export interface IRepositoryGetIssuesOptions extends IPagedCacheOptions {
  since?: Date;
  direction?: GitHubSortDirection;
  sort?: GetIssuesSort;
  labels?: string;
  mentioned?: string;
  creator?: string;
  assignee?: string; // user | 'none' | '*'
  state?: GitHubIssueQuery;
  milestone?: number | string; // '*'
}
