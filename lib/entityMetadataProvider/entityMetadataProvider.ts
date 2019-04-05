//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { IProviders } from '../../transitional';
import { IEntityMetadata, EntityMetadataType } from './entityMetadata';

export interface IEntityMetadataProviderCreateOptions {
  providers: IProviders;
  config: any;
  overrideProviderType?: string;
}

export enum FixedQueryType {
  ActiveTeamJoinApprovalsByTeam,
  ActiveTeamJoinApprovalsByTeams,
  ActiveTeamJoinApprovalsByThirdPartyId,
  AllActiveTeamJoinApprovals,
}

export interface IEntityMetadataFixedQuery {
  // A fixed set of query provider is less useful than a dynamic querying system
  // but also will help support a specific set of queries without too much
  // trouble or a generic query builder interface until needed

  fixedQueryType: FixedQueryType;
}

export class EntityMetadataFixedQueryByTeams implements IEntityMetadataFixedQuery {
  public readonly fixedQueryType: FixedQueryType = FixedQueryType.ActiveTeamJoinApprovalsByTeams;
  constructor(public ids: string[]) {
  }
}

export class EntityMetadataFixedQueryByTeam implements IEntityMetadataFixedQuery {
  public readonly fixedQueryType: FixedQueryType = FixedQueryType.ActiveTeamJoinApprovalsByTeam;
  constructor(public id: string) {
  }
}

export class EntityMetadataFixedQueryByThirdPartyUserId implements IEntityMetadataFixedQuery {
  public readonly fixedQueryType: FixedQueryType = FixedQueryType.ActiveTeamJoinApprovalsByTeam;
  constructor(public thirdPartyId: string) {
  }
}

export interface IEntityMetadataProvider {
  initialize(): Promise<void>;

  getMetadata(type: EntityMetadataType, id: string): Promise<IEntityMetadata>;
  setMetadata(metadata: IEntityMetadata): Promise<void>;

  supportsHistory: boolean;
  getMetadataHistory(type: EntityMetadataType, id: string): Promise<IEntityMetadata[]>;

  fixedQueryMetadata(type: EntityMetadataType, query: IEntityMetadataFixedQuery): Promise<IEntityMetadata[]>;
}
