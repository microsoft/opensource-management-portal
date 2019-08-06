//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

// Transitional interfaces

import { Application, Response, Request } from 'express';

import redis = require('redis');
import { Pool as PostgresPool } from 'pg';

import { IndividualContext } from './business/context2';
import { ICorporateLink } from './business/corporateLink';
import { ILinkProvider } from './lib/linkProviders/postgres/postgresLinkProvider';
import { IEntityMetadataProvider } from './lib/entityMetadataProvider/entityMetadataProvider';
import { IApprovalProvider } from './entities/teamJoinApproval/approvalProvider';
import { Operations } from './business/operations';
import { ITokenProvider } from './entities/token';
import { IMailAddressProvider } from './lib/mailAddressProvider';
import { IRepositoryMetadataProvider } from './entities/repositoryMetadata/repositoryMetadataProvider';
import { RedisHelper } from './lib/redis';
import { ILocalExtensionKeyProvider } from './entities/localExtensionKey';
import { PersonalAccessToken } from './entities/token/token';
import { Organization } from './business/organization';
import { IGraphProvider } from './lib/graphProvider';

export interface ICallback<T> {
  (error: Error, result?: T): void;
}

export interface ICacheOptions {
  backgroundRefresh?: any | null | undefined;
  maxAgeSeconds?: number | null | undefined;
  individualMaxAgeSeconds?: number | null | undefined;
}

export interface IMapPlusMetaCost extends Map<any, any> {
  headers?: any;
  cost?: any;
}

export interface IClassicLink {
  ghu: string;
  ghid: string; // ?
  aadupn: string;
  aadname?: string;
  aadoid: string;
  ghavatar?: string;
  githubToken?: string;
  githubTokenUpdated?: any;
  githubTokenIncreasedScope?: string;
  githubTokenIncreasedScopeUpdated?: any;
  joined?: Date;
  serviceAccount?: boolean;
}

export interface IProviders {
  approvalProvider?: IApprovalProvider;
  basedir?: string;
  cosmosdb?: any;
  config?: any;
  // entityMetadata?: IEntityMetadataProvider;
  healthCheck?: any;
  keyEncryptionKeyResolver?: any;
  github?: any;
  graphProvider?: IGraphProvider;
  insights?: any;
  linkProvider?: ILinkProvider;
  localExtensionKeyProvider?: ILocalExtensionKeyProvider;
  mailAddressProvider?: IMailAddressProvider;
  mailProvider?: any;
  operations?: Operations;
  postgresPool?: PostgresPool;
  redis?: RedisHelper;
  redisClient?: redis.RedisClient;
  repositoryMetadataProvider?: IRepositoryMetadataProvider;
  witnessRedis?: redis.RedisClient;
  witnessRedisHelper?: RedisHelper;
  tokenProvider?: ITokenProvider;
}

export interface RedisOptions {
  auth_pass: string;
  detect_buffers: boolean;
  tls?: {
    servername: string;
  }
}

export interface InnerError extends Error {
  inner?: Error;
}

export interface IReposError extends Error {
  skipLog?: boolean;
  status?: number;
  originalUrl?: any;
  detailed?: any;
  redirect?: string;
  skipOops?:boolean;
  fancyLink?: {
    link: string;
    title: string;
  };
  innerError?: Error;
}

export interface Application extends Application {
  // Standard Express
  set(settingName: string, settingValue: any);

  // Local things
  providers: IProviders;
}

export interface IReposAppContext {
  section?: string;
  pivotDirectlyToOtherOrg?: string;
  releaseTab?: boolean;
  organization?: Organization;
}

export interface ReposAppRequest extends Request {
  // passport
  isAuthenticated(): boolean;
  user: any;

  // our extensions
  insights?: any;
  reposContext?: IReposAppContext;
  currentOrganizationMemberships?: any; // needs a redesign
  teamsPagerMode?: string;
  reposPagerMode?: string;
  link?: any; // not sure when this is set
  organization?: Organization;
  correlationId?: string;

  // FUTURE:
  apiContext: IndividualContext;
  individualContext: IndividualContext;
}

export interface IReposAppResponse extends Response {
}

export interface IReposRequestWithOrganization extends ReposAppRequest {
  organization?: any;
}

export interface IRequestTeams extends ReposAppRequest {
  team2?: any;
  teamUrl?: any;
}

export interface RequestWithSystemwidePermissions extends ReposAppRequest {
  systemWidePermissions?: any;
}

export interface IResponseForSettingsPersonalAccessTokens extends Response {
  newKey?: string;
}

export function translateNewLinksArrayToOldTemporarily(links: ICorporateLink[]): IClassicLink[] {
  return links.map(translateNewLinkFormatToOldTemporarily) as any[] as IClassicLink[];
}

export function translateNewLinkFormatToOldTemporarily(link: ICorporateLink): IClassicLink {
  const ancientLink: IClassicLink = {
    aadoid: link.corporateId,
    aadupn: link.corporateUsername,
    ghu: link.thirdPartyUsername,
    ghid: link.thirdPartyId,
    ghavatar: link.thirdPartyAvatar,
    serviceAccount: link.isServiceAccount,
  };
  return ancientLink;
}

// Not used... yet.

interface ITooManyLinksError extends Error {
  links?: any;
  tooManyLinks?: boolean;
}

interface IExistingIdentityError extends Error {
  anotherAccount?: boolean;
  link?: any;
  skipLog?: boolean;
}

function tooManyLinksError(self, userLinks, callback) {
  const tooManyLinksError: ITooManyLinksError = new Error(`This account has ${userLinks.length} linked GitHub accounts.`);
  tooManyLinksError.links = userLinks;
  tooManyLinksError.tooManyLinks = true;
  return callback(tooManyLinksError, self);
}

function existingGitHubIdentityError(self, link, requestUser, callback) {
  const endUser = requestUser.azure.displayName || requestUser.azure.username;
  const anotherGitHubAccountError: IExistingIdentityError = new Error(`${endUser}, there is a different GitHub account linked to your corporate identity.`);
  anotherGitHubAccountError.anotherAccount = true;
  anotherGitHubAccountError.link = link;
  anotherGitHubAccountError.skipLog = true;
  return callback(anotherGitHubAccountError, self);
}