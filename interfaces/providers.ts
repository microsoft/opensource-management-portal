//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { TelemetryClient } from 'applicationinsights';
import { AuthorizationCode } from 'simple-oauth2';
import redis, { RedisClientType } from 'redis';
import { Pool as PostgresPool } from 'pg';

import {
  IApplicationProfile,
  ICorporationAdministrationSection,
  IReposApplication,
  SiteConfiguration,
} from '.';
import { Operations } from '../business';
import QueryCache from '../business/queryCache';
import { IAuditLogRecordProvider } from '../entities/auditLogRecord/auditLogRecordProvider';
import { ILocalExtensionKeyProvider } from '../entities/localExtensionKey';
import { IOrganizationMemberCacheProvider } from '../entities/organizationMemberCache/organizationMemberCacheProvider';
import { IOrganizationSettingProvider } from '../entities/organizationSettings/organizationSettingProvider';
import { IRepositoryCacheProvider } from '../entities/repositoryCache/repositoryCacheProvider';
import { IRepositoryCollaboratorCacheProvider } from '../entities/repositoryCollaboratorCache/repositoryCollaboratorCacheProvider';
import { IRepositoryTeamCacheProvider } from '../entities/repositoryTeamCache/repositoryTeamCacheProvider';
import { ITeamCacheProvider } from '../entities/teamCache/teamCacheProvider';
import { IApprovalProvider } from '../entities/teamJoinApproval/approvalProvider';
import { ITeamMemberCacheProvider } from '../entities/teamMemberCache/teamMemberCacheProvider';
import { ITokenProvider } from '../entities/token';
import { IUserSettingsProvider } from '../entities/userSettings';
import { ICacheHelper } from '../lib/caching';
import BlobCache from '../lib/caching/blob';
import { ICampaignHelper } from '../lib/campaigns';
import { RestLibrary } from '../lib/github';
import { IGraphProvider } from '../lib/graphProvider';
import { ILinkProvider } from '../lib/linkProviders';
import { IMailAddressProvider } from '../lib/mailAddressProvider';
import { IMailProvider } from '../lib/mailProvider';
import { IQueueProcessor } from '../lib/queues';
import { ICustomizedNewRepositoryLogic, ICustomizedTeamPermissionsWebhookLogic } from '../transitional';
import { IEntityMetadataProvider } from '../lib/entityMetadataProvider';
import { IRepositoryProvider } from '../entities/repository';
import { IKeyVaultSecretResolver } from '../lib/keyVaultResolver';
import { IOrganizationAnnotationMetadataProvider } from '../entities/organizationAnnotation';
import type { IImmutableStorageProvider } from '../lib/immutable';

type ProviderGenerator = (value: string) => IEntityMetadataProvider;

export interface IProviders {
  app: IReposApplication;
  applicationProfile: IApplicationProfile;
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
  localExtensionKeyProvider?: ILocalExtensionKeyProvider;
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
  tokenProvider?: ITokenProvider;
  viewServices?: any;
  //redis?: RedisHelper;
  //redisClient?: redis.RedisClient;
}
