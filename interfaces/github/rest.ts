//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { AppPurposeTypes } from '../../lib/github/appPurposes';

export interface ICacheOptions {
  backgroundRefresh?: any | null | undefined;
  maxAgeSeconds?: number | null | undefined;
}

export interface ICacheOptionsWithPurpose extends ICacheOptions {
  purpose?: AppPurposeTypes;
}

export type WithOptionalPurpose = {
  purpose?: AppPurposeTypes;
};

export interface IPagedCacheOptions extends ICacheOptions {
  pageRequestDelay?: number | null | undefined; // FUTURE: could be a function, too
}

export type PagedCacheOptionsWithPurpose = IPagedCacheOptions & WithOptionalPurpose;

export type PurposefulGetAuthorizationHeader = (
  purpose: AppPurposeTypes
) => Promise<AuthorizationHeaderValue>;

export type GetAuthorizationHeader = () => Promise<AuthorizationHeaderValue>;

export type AuthorizationHeaderValue = {
  value: string;
  purpose: AppPurposeTypes;
  source?: string;
  installationId?: number;
  organizationName?: string;
};

export interface ICacheDefaultTimes {
  orgReposStaleSeconds: number;
  orgRepoTeamsStaleSeconds: number;
  orgRepoCollaboratorsStaleSeconds: number;
  orgRepoCollaboratorStaleSeconds: number;
  orgRepoDetailsStaleSeconds: number;
  orgTeamsStaleSeconds: number;
  orgTeamDetailsStaleSeconds: number;
  orgTeamsSlugLookupStaleSeconds: number;
  orgMembersStaleSeconds: number;
  teamMaintainersStaleSeconds: number;
  orgMembershipStaleSeconds: number;
  orgMembershipDirectStaleSeconds: number;
  crossOrgsReposStaleSecondsPerOrg: number;
  crossOrgsReposParallelCalls: number;
  crossOrgsMembersStaleSecondsPerOrg: number;
  crossOrgsMembersParallelCalls: number;
  corporateLinksStaleSeconds: number;
  repoBranchesStaleSeconds: number;
  repoPullsStaleSeconds: number;
  accountDetailStaleSeconds: number;
  teamDetailStaleSeconds: number;
  orgRepoWebhooksStaleSeconds: number;
  teamRepositoryPermissionStaleSeconds: number;
  defaultStaleSeconds: number;
}

// These "core capabilities" were created when the GitHub operations
// classes were refactored to support both GitHub Enterprise Cloud and
// also GitHub AE. Not all operations are supported by both environments
// the same.

export enum CoreCapability {
  GitHubRestApi = 'GitHub REST API', // IOperationsGitHubRestLibrary
  DefaultCacheTimes = 'Default cache times', // IOperationsDefaultCacheTimes
  GitHubCentralOperations = 'GitHub central operations', // IOperationsCentralOperationsToken
  Urls = 'urls', // IOperationsUrls
  LockdownFeatureFlags = 'Lockdown feature flags', // IOperationsLockdownFeatureFlags
  Providers = 'Providers', // IOperationsProviders
  LegalEntities = 'Legal entities', // IOperationsLegalEntities
  ServiceAccounts = 'Service Accounts', // IOperationsServiceAccounts
  Links = 'Links', // IOperationsLinks
  Templates = 'Templates', // IOperationsTemplates
  RepositoryMetadataProvider = 'RepositoryMetadataProvider', // IOperationsRepositoryMetadataProvider
  Hierarchy = 'Hierarchy', // IOperationsHierarchy
  Notifications = 'Notifications', // IOperationsNotifications
}

export interface IAlternateTokenOption {
  alternateToken: string;
}

export interface IAlternateTokenRequiredOptions extends ICacheOptions, IAlternateTokenOption {}

export interface IPagedCrossOrganizationCacheOptions extends IPagedCacheOptions {
  individualMaxAgeSeconds?: number | null | undefined;
  individualRequestDelay?: number | null | undefined; // FUTURE: could be a function, too
}

export interface ILocalCacheOptions extends ICacheOptions {
  localMaxAgeSeconds?: number;
}

export interface ICacheOptionsPageLimiter extends ICacheOptions {
  pageLimit?: number;
}

export interface IMapPlusMetaCost extends Map<any, any> {
  headers?: any;
  cost?: IReposRestRedisCacheCost;
}

export interface IReposRestRedisCacheCost {
  github: {
    cacheHits: number;
    remainingApiTokens: string;
    restApiCalls: number;
    usedApiTokens: number;
  };
  local: {
    cacheHits: number;
    cacheMisses: number;
  };
  redis: {
    cacheHits: number;
    cacheMisses: number;
    expireCalls: number;
    getCalls: number;
    setCalls: number;
  };
}

export const NoCacheNoBackground = { backgroundRefresh: false, maxAgeSeconds: -1 };

export const CacheTwoHoursNoBackground = { backgroundRefresh: false, maxAgeSeconds: 60 * 60 * 2 };

export const CacheSixHoursNoBackground = { backgroundRefresh: false, maxAgeSeconds: 60 * 60 * 6 };

export const CacheTwoDaysNoBackground = { backgroundRefresh: false, maxAgeSeconds: 60 * 60 * 24 * 2 };
