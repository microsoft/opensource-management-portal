//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { Operations } from '../../business/operations/core.js';
import { GitHubRepositoryPermission } from './repos.js';

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

export function getRepositoryMetadataProvider(operations: Operations) {
  return operations.repositoryMetadataProvider;
}
