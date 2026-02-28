//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { TelemetryClient } from 'applicationinsights';
import { AuthorizationCode } from 'simple-oauth2';
import { RedisClientType } from 'redis';

import type { Pool as PostgresPool } from 'pg';

import type {
  ApplicationProfile,
  ICorporationAdministrationSection,
  IReposApplication,
  SiteConfiguration,
} from './index.js';
import { Operations } from '../business/index.js';
import QueryCache from '../business/queryCache.js';
import type { IAuditLogRecordProvider } from '../business/entities/auditLogRecord/auditLogRecordProvider.js';
import type { IOrganizationMemberCacheProvider } from '../business/entities/organizationMemberCache/organizationMemberCacheProvider.js';
import type { IOrganizationSettingProvider } from '../business/entities/organizationSettings/organizationSettingProvider.js';
import type { IRepositoryCacheProvider } from '../business/entities/repositoryCache/repositoryCacheProvider.js';
import type { IRepositoryCollaboratorCacheProvider } from '../business/entities/repositoryCollaboratorCache/repositoryCollaboratorCacheProvider.js';
import type { IRepositoryTeamCacheProvider } from '../business/entities/repositoryTeamCache/repositoryTeamCacheProvider.js';
import type { ITeamCacheProvider } from '../business/entities/teamCache/teamCacheProvider.js';
import type { IApprovalProvider } from '../business/entities/teamJoinApproval/approvalProvider.js';
import type { ITeamMemberCacheProvider } from '../business/entities/teamMemberCache/teamMemberCacheProvider.js';
import type { IUserSettingsProvider } from '../business/entities/userSettings.js';
import type { ICacheHelper } from '../lib/caching/index.js';
import BlobCache from '../lib/caching/blob.js';
import type { ICampaignHelper } from '../lib/campaignState/campaigns.js';
import type { RestLibrary } from '../lib/github/index.js';
import type { IGraphProvider } from '../lib/graphProvider/index.js';
import type { ILinkProvider } from '../lib/linkProviders/index.js';
import type { IMailAddressProvider } from '../lib/mailAddressProvider/index.js';
import type { IMailProvider } from '../lib/mailProvider/index.js';
import type { IQueueProcessor } from '../lib/queues/index.js';
import type {
  ICustomizedNewRepositoryLogic,
  ICustomizedTeamPermissionsWebhookLogic,
} from '../lib/transitional.js';
import type { IEntityMetadataProvider } from '../lib/entityMetadataProvider/index.js';
import type { IRepositoryProvider } from '../business/entities/repository.js';
import type { IKeyVaultSecretResolver } from '../lib/keyVaultResolver.js';
import type { IOrganizationAnnotationMetadataProvider } from '../business/entities/organizationAnnotation.js';
import type { IImmutableStorageProvider } from '../lib/immutable.js';

export type AppInsightsTelemetryClient = TelemetryClient;

type ProviderGenerator = (value: string) => IEntityMetadataProvider;

export interface IProviders {
  app: IReposApplication;
  applicationProfile: ApplicationProfile;
  authorizationCodeClient?: AuthorizationCode;
  corporateAdministrationProfile?: ICorporationAdministrationSection;
  corporateViews?: any;
  approvalProvider?: IApprovalProvider;
  auditLogRecordProvider?: IAuditLogRecordProvider;
  basedir?: string;
  campaignStateProvider?: ICampaignHelper;
  campaign?: any; // campaign redirection route, poor variable name
  config?: SiteConfiguration;
  customizedNewRepositoryLogic?: ICustomizedNewRepositoryLogic;
  customizedTeamPermissionsWebhookLogic?: ICustomizedTeamPermissionsWebhookLogic;
  defaultEntityMetadataProvider?: IEntityMetadataProvider;
  diagnosticsDrop?: BlobCache;
  healthCheck?: any;
  keyEncryptionKeyResolver?: IKeyVaultSecretResolver;
  getEntityProviderByType?: ProviderGenerator;
  genericInsights?: TelemetryClient;
  github?: RestLibrary;
  graphProvider?: IGraphProvider;
  immutable?: IImmutableStorageProvider;
  insights?: TelemetryClient;
  linkProvider?: ILinkProvider;
  mailAddressProvider?: IMailAddressProvider;
  mailProvider?: IMailProvider;
  operations?: Operations;
  organizationAnnotationsProvider?: IOrganizationAnnotationMetadataProvider;
  organizationMemberCacheProvider?: IOrganizationMemberCacheProvider;
  organizationSettingsProvider?: IOrganizationSettingProvider;
  postgresPool?: PostgresPool;
  queryCache?: QueryCache;
  webhookQueueProcessor?: IQueueProcessor;
  sessionRedisClient?: RedisClientType;
  cacheProvider?: ICacheHelper;
  repositoryProvider?: IRepositoryProvider;
  repositoryCacheProvider?: IRepositoryCacheProvider;
  repositoryCollaboratorCacheProvider?: IRepositoryCollaboratorCacheProvider;
  repositoryTeamCacheProvider?: IRepositoryTeamCacheProvider;
  session?: any;
  teamCacheProvider?: ITeamCacheProvider;
  teamMemberCacheProvider?: ITeamMemberCacheProvider;
  userSettingsProvider?: IUserSettingsProvider;
  viewServices?: any;
}

export type IProvidersWithoutInsights = Omit<IProviders, 'insights'>;
