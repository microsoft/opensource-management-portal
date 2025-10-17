//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import {
  EnhancedPagedCacheOptions,
  GetAuthorizationHeader,
  ICacheOptions,
  PurposefulGetAuthorizationHeader,
} from '../interfaces/index.js';
import {
  evenMoreBasicAccountProperties,
  type CollectionCopilotSeatsOptions,
  type WithSubPropertyReducer,
} from '../lib/github/collections.js';
import { AppPurpose, AppPurposeTypes } from '../lib/github/appPurposes.js';
import {
  CacheDefault,
  getMaxAgeSeconds,
  getPageSize,
  Operations,
  symbolizeApiResponse,
} from './operations/core.js';
import { Organization } from './organization.js';

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

export type CopilotDailyBreakdown = {
  language: string;
  editor: string;
  suggestions_count: number;
  acceptances_count: number;
  lines_suggested: number;
  lines_accepted: number;
  active_users: number;
};

export type CopilotDailySummary = {
  day: string;
  total_suggestions_count: number;
  total_acceptances_count: number;
  total_lines_suggested: number;
  total_lines_accepted: number;
  total_active_users: number;
  total_chat_acceptances: number;
  total_chat_turns: number;
  total_active_chat_users: number;
  breakdown: CopilotDailyBreakdown[];
};

export type CopilotMetricsCompletionsLanguage = {
  language: string;
  total_engaged_users: number;
};

export type CopilotModelLanguageTotals = {
  name: string;
  total_engaged_users: number;
  total_code_suggestions: number;
  total_code_acceptances: number;
  total_code_lines_suggested: number;
  total_code_lines_accepted: number;
};

export type CopilotMetricsCompletionsModel = {
  name: string;
  is_custom_model: boolean;
  custom_model_training_date: string; // iso8601
  total_engaged_users: number;
  languages: CopilotModelLanguageTotals[];
};

export type CopilotMetricsCompletionsEditor = {
  name: string;
  total_engaged_users: number;
  models: CopilotMetricsCompletionsModel[];
};

export type CopilotMetricsChatEditor = {
  name: string;
  total_engaged_users: number;
  models: CopilotMetricsEditorChatModel[];
};

export type CopilotMetricsDotcomChatModel = {
  name: string;
  is_custom_model: boolean;
  custom_model_training_date: string; // iso8601
  total_engaged_users: number;
  total_chats: number;
};

export type CopilotMetricsEditorChatModel = {
  name: string;
  is_custom_model: boolean;
  custom_model_training_date: string; // iso8601
  total_engaged_users: number;
  total_chat_turns: number;
  total_chat_insertion_events: number;
  total_chat_copy_events: number;
};

export type CopilotMetricsCompletionsGroup = {
  total_engaged_users: number;
  languages: CopilotMetricsCompletionsLanguage[];
  editors: CopilotMetricsCompletionsEditor[];
};

export type CopilotMetricsDotcomChat = {
  total_engaged_users: number;
  models: CopilotMetricsDotcomChatModel[];
};

export type CopilotMetricsChatGroup = {
  total_engaged_users: number;
  editors: CopilotMetricsChatEditor[];
};

export type CopilotMetricsDotcomPullRequestModel = {
  name: string;
  is_custom_model: boolean;
  custom_model_training_date: string; // iso8601
  total_pr_summaries_created: number;
  total_engaged_users: number;
};

export type CopilotMetricsDotcomPullRequestRepository = {
  name: string;
  total_engaged_users: number;
  models: CopilotMetricsDotcomPullRequestModel[];
};

export type CopilotMetricsDotcomPullRequests = {
  total_engaged_users: number;
  repositories: CopilotMetricsDotcomPullRequestRepository[];
};

export type CopilotDailyMetricsSummary = {
  date: string;
  total_active_users: number;
  total_engaged_users: number;
  copilot_ide_code_completions: CopilotMetricsCompletionsGroup;
  copilot_ide_chat: CopilotMetricsChatGroup;
  copilot_dotcom_chat: CopilotMetricsDotcomChat;
  copilot_dotcom_pull_requests: CopilotMetricsDotcomPullRequests;
};

export type CopilotMetricsSummary = CopilotDailySummary[];

export type CopilotHistoricalMetrics = CopilotDailyMetricsSummary[];

export class OrganizationCopilot {
  constructor(
    private organization: Organization,
    private getSpecificAuthorizationHeader: PurposefulGetAuthorizationHeader,
    private operations: Operations
  ) {}

  async getSeatActivity(
    options?: EnhancedPagedCacheOptions,
    appPurpose: AppPurposeTypes = AppPurpose.Data
  ): Promise<CopilotSeatData[]> {
    options = options || {};
    const operations = this.operations as Operations;
    const getAuthorizationHeader = this.getSpecificAuthorizationHeader.bind(
      this,
      appPurpose
    ) as GetAuthorizationHeader;
    const github = operations.github;
    const perPage = options.perPage || getPageSize(operations);
    if (options.perPage) {
      delete options.perPage;
    }
    const parameters: CollectionCopilotSeatsOptions = {
      // org: this.organization.name,
      per_page: perPage,
    } as any;
    const caching = {
      maxAgeSeconds: getMaxAgeSeconds(operations as Operations, CacheDefault.orgMembersStaleSeconds, options),
      backgroundRefresh: true,
      pageRequestDelay: options.pageRequestDelay,
    };
    if (options && options.backgroundRefresh === false) {
      caching.backgroundRefresh = false;
    }
    const seats = await github.collections.collectAllPagesViaHttpGetWithRequirements<any, CopilotSeatData>(
      'orgCopilotSeats',
      github.createRequirementsForRequest(
        getAuthorizationHeader,
        `GET /orgs/${this.organization.name}/copilot/billing/seats`,
        {
          permissions: {
            permission: 'organization_copilot_seat_management',
            access: 'read', // technically 'write' per API
          },
        }
      ),
      parameters,
      caching,
      copilotSeatPropertiesToCopy,
      'seats'
    );
    return seats;
  }

  async getDailyMetrics(
    options?: ICacheOptions,
    appPurpose: AppPurposeTypes = AppPurpose.Data
  ): Promise<CopilotHistoricalMetrics> {
    options = options || {};
    const operations = this.operations as Operations;
    const getAuthorizationHeader = this.getSpecificAuthorizationHeader.bind(
      this,
      appPurpose
    ) as GetAuthorizationHeader;
    const github = operations.github;
    const parameters = {
      org: this.organization.name,
    };
    const caching = {
      maxAgeSeconds: getMaxAgeSeconds(operations as Operations, CacheDefault.orgMembersStaleSeconds, options),
      backgroundRefresh: true,
    };
    if (options && options.backgroundRefresh === false) {
      caching.backgroundRefresh = false;
    }
    try {
      // X-GitHub-Api-Version: 2022-11-28
      const result: CopilotMetricsSummary = await github.requestWithRequirements(
        github.createRequirementsForRequest(getAuthorizationHeader, 'GET /orgs/:org/copilot/metrics', {
          permissions: {
            permission: 'organization_copilot_seat_management',
            access: 'read',
          },
        }),
        parameters,
        caching
      );
      return symbolizeApiResponse(result);
    } catch (error) {
      throw error;
    }
  }
}

const copilotSeatPropertiesToCopy: WithSubPropertyReducer = [
  'created_at',
  'updated_at',
  'last_activity_at',
  'last_activity_editor',
  'assignee', // id, login; mostBasicAccountProperties
];
copilotSeatPropertiesToCopy.subPropertiesToReduce = {
  assignee: evenMoreBasicAccountProperties,
};
