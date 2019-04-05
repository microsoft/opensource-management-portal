//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

export enum EntityMetadataType {
  // GitHub entities
  Organization,
  Repository,
  Team,

  // App-specific entities
  TeamJoinRequest,
}

export interface IEntityMetadata {
  entityType: EntityMetadataType;
  entityId: string;
  fields: any;
  created: Date;
}
