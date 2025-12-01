//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { TelemetryClient } from 'applicationinsights';
import { AuthorizationCode } from 'simple-oauth2';
import { RedisClientType } from 'redis';

import type { Pool as PostgresPool } from 'pg';

import {
  ApplicationProfile,
  ICorporationAdministrationSection,
  IReposApplication,
  SiteConfiguration,
} from './index.js';
import { Operations } from '../business/index.js';
import QueryCache from '../business/queryCache.js';
import { IAuditLogRecordProvider } from '../business/entities/auditLogRecord/auditLogRecordProvider.js';
import { IOrganizationMemberCacheProvider } from '../business/entities/organizationMemberCache/organizationMemberCacheProvider.js';
import { IOrganizationSettingProvider } from '../business/entities/organizationSettings/organizationSettingProvider.js';
import { IRepositoryCacheProvider } from '../business/entities/repositoryCache/repositoryCacheProvider.js';
import { IRepositoryCollaboratorCacheProvider } from '../business/entities/repositoryCollaboratorCache/repositoryCollaboratorCacheProvider.js';
import { IRepositoryTeamCacheProvider } from '../business/entities/repositoryTeamCache/repositoryTeamCacheProvider.js';
import { ITeamCacheProvider } from '../business/entities/teamCache/teamCacheProvider.js';
import { IApprovalProvider } from '../business/entities/teamJoinApproval/approvalProvider.js';
import { ITeamMemberCacheProvider } from '../business/entities/teamMemberCache/teamMemberCacheProvider.js';
import { IUserSettingsProvider } from '../business/entities/userSettings.js';
import { ICacheHelper } from '../lib/caching/index.js';
import BlobCache from '../lib/caching/blob.js';
import { ICampaignHelper } from '../lib/campaignState/campaigns.js';
import { RestLibrary } from '../lib/github/index.js';
import { IGraphProvider } from '../lib/graphProvider/index.js';
import { ILinkProvider } from '../lib/linkProviders/index.js';
import { IMailAddressProvider } from '../lib/mailAddressProvider/index.js';
import { IMailProvider } from '../lib/mailProvider/index.js';
import { IQueueProcessor } from '../lib/queues/index.js';
import {
  ICustomizedNewRepositoryLogic,
  ICustomizedTeamPermissionsWebhookLogic,
} from '../lib/transitional.js';
import { IEntityMetadataProvider } from '../lib/entityMetadataProvider/index.js';
import { IRepositoryProvider } from '../business/entities/repository.js';
import { IKeyVaultSecretResolver } from '../lib/keyVaultResolver.js';
import { IOrganizationAnnotationMetadataProvider } from '../business/entities/organizationAnnotation.js';
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
