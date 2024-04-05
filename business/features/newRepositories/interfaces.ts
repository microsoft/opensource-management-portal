//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { TelemetryClient } from 'applicationinsights';

import { Operations, Organization, Repository } from '../..';
import { IRepositoryMetadataProvider } from '../../entities/repositoryMetadata/repositoryMetadataProvider';
import { ICorporateLink, RepositoryLockdownState } from '../../../interfaces';

export enum RepositoryLockdownCreateType {
  Created = 'created',
  Transferred = 'transferred',
}

export type RepositoryLockdownCreateProviders = {
  insights: TelemetryClient;
  operations: Operations;
  repositoryMetadataProvider: IRepositoryMetadataProvider;
};

export type RepositoryLockdownCreateInstances = {
  repository: Repository;
};

export type RepositoryLockdownCreateOptions = {
  action: RepositoryLockdownCreateType;
  username: string;
  thirdPartyId: number;
  transferSourceRepositoryLogin: string;
  lockdownLog: string[];
  link: ICorporateLink;
  lockdownState: RepositoryLockdownState;
  providers: RepositoryLockdownCreateProviders;
  instances: RepositoryLockdownCreateInstances;
};

export interface IRepoPatch {
  private?: boolean;
  description?: string;
  homepage?: string;
}

export interface ILockdownResult {
  wasLocked: boolean;
  notifyOperations: boolean;
  setupUrl?: string;
  log?: string[];
  lockdownState?: RepositoryLockdownState;

  upstreamLogin?: string;
  upstreamRepositoryName?: string;
  isForkParentManagedBySystem?: boolean;
}

export interface IMailToRemoveAdministrativeLock {
  organization: Organization;
  repository: Repository;
  linkToClassifyRepository: string;
  linkToDeleteRepository: string;
  mailAddress?: string;
}

export interface IMailToLockdownRepo {
  username: string;
  log: string[];
  organization: Organization;
  repository: Repository;
  linkToClassifyRepository: string;
  linkToDeleteRepository: string;
  linkToAdministrativeUnlockRepository: string;
  mailAddress?: string;
  link?: ICorporateLink;
  isForkAdministratorLocked: boolean;
  isForkDeleted: boolean;
}

export type NewRepositoryLockdownSystemOptions = {
  insights: TelemetryClient;
  operations: Operations;
  organization: Organization;
  repository: Repository;
  repositoryMetadataProvider: IRepositoryMetadataProvider;
};
