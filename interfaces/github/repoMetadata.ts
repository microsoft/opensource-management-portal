//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { GitHubRepositoryPermission } from '../../entities/repositoryMetadata/repositoryMetadata';
import {
  IOperationsInstance,
  IOperationsRepositoryMetadataProvider,
  operationsWithCapability,
  throwIfNotCapable,
} from './operations';
import { CoreCapability } from './rest';

export interface IRepositoryMetadataPermissionPair {
  id: string;
  permission: GitHubRepositoryPermission;
}

export interface IRepositoryMetadata {
  schema: string;

  apiVersion: string;
  correlationId: string;

  id: string;

  created: Date;

  name: string;
  description: string;
  visibility: string;

  policy: string;
  policyUrl: string;

  license: string;
  legalEntity: string;

  template: string;
  gitIgnoreTemplate: string;

  teamPermissions: IRepositoryMetadataPermissionPair[];
}

export function getRepositoryMetadataProvider(operations: IOperationsInstance) {
  const ops = throwIfNotCapable<IOperationsRepositoryMetadataProvider>(
    operations,
    CoreCapability.RepositoryMetadataProvider
  );
  return ops.repositoryMetadataProvider;
}
