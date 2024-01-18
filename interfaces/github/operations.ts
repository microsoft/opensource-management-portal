//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import {
  CoreCapability,
  ICacheDefaultTimes,
  PurposefulGetAuthorizationHeader,
  ICacheOptions,
  GetAuthorizationHeader,
} from '.';
import { IProviders, ICorporateLink, ICachedEmployeeInformation } from '..';
import { IRepositoryMetadataProvider } from '../../business/entities/repositoryMetadata/repositoryMetadataProvider';
import { RestLibrary } from '../../lib/github';
import { Account } from '../../business';

export interface IOperationsInstance {
  hasCapability(capability: CoreCapability): boolean;
  throwIfNotCompatible(capability: CoreCapability): void;
} // Messy but allows for optional use with a cast

export interface IOperationsLegalEntities {
  getDefaultLegalEntities(): string[];
}

export interface IOperationsTemplates {
  getDefaultRepositoryTemplateNames(): string[];
}

export interface IOperationsProviders {
  providers: IProviders;
}

export type LinkEvent = ICorporateLink & {
  linkId: string;
  correlationId: string;
};

export type UnlinkEvent = {
  github: {
    id: number;
    login: string;
  };
  aad: {
    preferredName: string;
    userPrincipalName: string;
    id: string;
  };
};

export interface IOperationsLinks {
  getLinks(options?: any): Promise<ICorporateLink[]>;
  getLinkByThirdPartyId(thirdPartyId: string): Promise<ICorporateLink>;
  getLinkByThirdPartyUsername(username: string): Promise<ICorporateLink>;
  tryGetLink(login: string): Promise<ICorporateLink>;
  fireLinkEvent(value: LinkEvent): Promise<void>;
  fireUnlinkEvent(value: UnlinkEvent): Promise<void>;
}

export interface IOperationsNotifications {
  getOperationsMailAddress(): string;
  getLinksNotificationMailAddress(): string;
  getRepositoriesNotificationMailAddress(): string;
}

export interface IOperationsRepositoryMetadataProvider {
  repositoryMetadataProvider: IRepositoryMetadataProvider;
}

export interface IOperationsServiceAccounts {
  isSystemAccountByUsername(login: string): boolean;
}

export interface IOperationsGitHubRestLibrary {
  github: RestLibrary;
  githubSkuName: string;
}

export interface IOperationsDefaultCacheTimes {
  defaults: ICacheDefaultTimes;
}

export interface IOperationsHierarchy {
  getCachedEmployeeManagementInformation(corporateId: string): Promise<ICachedEmployeeInformation>;
}

export interface IOperationsUrls {
  baseUrl: string;
  absoluteBaseUrl: string;
  organizationsDeliminator: string;
  repositoriesDeliminator: string;
  nativeUrl: string;
  nativeManagementUrl: string;
}

export interface IOperationsLockdownFeatureFlags {
  allowUnauthorizedNewRepositoryLockdownSystemFeature(): boolean;
  allowUnauthorizedForkLockdownSystemFeature(): boolean;
  allowTransferLockdownSystemFeature(): boolean;
}

export interface IOperationsCentralOperationsToken {
  getAccountByUsername(username: string, options?: ICacheOptions): Promise<Account>;
  getPublicReadOnlyStaticToken(): GetAuthorizationHeader;
  getPublicAuthorizationToken(): GetAuthorizationHeader;
}

export function operationsIsCapable<T>(
  operations: IOperationsInstance,
  capability: CoreCapability
): operations is IOperationsInstance & T {
  return operations.hasCapability(capability);
}

export function operationsWithCapability<T>(
  operations: IOperationsInstance,
  capability: CoreCapability
): T & IOperationsInstance {
  if (operationsIsCapable<T>(operations, capability)) {
    return operations as T & IOperationsInstance;
  }
  return null;
}

export function throwIfNotCapable<T>(operations: IOperationsInstance, capability: CoreCapability) {
  operations.throwIfNotCompatible(capability);
  return operations as any as T & IOperationsInstance;
}

export function throwIfNotGitHubCapable(operations: IOperationsInstance) {
  return throwIfNotCapable<IOperationsGitHubRestLibrary & IOperationsInstance>(
    operations,
    CoreCapability.GitHubRestApi
  );
}
