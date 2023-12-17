//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import {
  GetAuthorizationHeader,
  IOperationsInstance,
  IPagedCacheOptions,
  PurposefulGetAuthorizationHeader,
  throwIfNotGitHubCapable,
} from '../interfaces';
import type { CollectionCopilotSeatsOptions } from '../lib/github/collections';
import { AppPurpose, AppPurposeTypes } from '../lib/github/appPurposes';
import { CacheDefault, getMaxAgeSeconds, getPageSize } from './operations/core';
import { Organization } from './organization';

export type CopilotSeatData = {
  assignee: {
    avatar_url: string;
    id: number;
    login: string;
  };
  created_at: string;
  updated_at: string;
  last_activity_at: string;
  last_activity_editor: string;
};

export class OrganizationCopilot {
  constructor(
    private organization: Organization,
    private getSpecificAuthorizationHeader: PurposefulGetAuthorizationHeader,
    private operations: IOperationsInstance
  ) {}

  async getSeatActivity(
    options?: IPagedCacheOptions,
    appPurpose: AppPurposeTypes = AppPurpose.Data
  ): Promise<CopilotSeatData[]> {
    options = options || {};
    const operations = throwIfNotGitHubCapable(this.operations);
    const getAuthorizationHeader = this.getSpecificAuthorizationHeader.bind(
      this,
      appPurpose
    ) as GetAuthorizationHeader;
    const github = operations.github;
    const parameters: CollectionCopilotSeatsOptions = {
      org: this.organization.name,
      per_page: getPageSize(operations),
    };
    const caching = {
      maxAgeSeconds: getMaxAgeSeconds(operations, CacheDefault.orgMembersStaleSeconds, options),
      backgroundRefresh: true,
      pageRequestDelay: options.pageRequestDelay,
    };
    if (options && options.backgroundRefresh === false) {
      caching.backgroundRefresh = false;
    }
    // (caching as any).pageLimit = 10;
    const seats = (await github.collections.getOrganizationCopilotSeats(
      getAuthorizationHeader,
      parameters,
      caching
    )) as CopilotSeatData[];
    return seats;
  }
}
