//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { IEntityMetadata } from "./entityMetadata";

export enum FixedQueryType {
  // Team join
  ActiveTeamJoinApprovalsByTeam,
  ActiveTeamJoinApprovalsByTeams,
  ActiveTeamJoinApprovalsByThirdPartyId,
  AllActiveTeamJoinApprovals,
  AllTeamJoinApprovals,
  // Repo metadata
  AllRepositoryMetadata,
  RepositoryMetadataByRepositoryId,
  // Tokens
  TokensByCorporateId,
  TokensGetAll,
}

export interface IEntityMetadataFixedQuery {
  // A fixed set of query provider is less useful than a dynamic querying system
  // but also will help support a specific set of queries without too much
  // trouble or a generic query builder interface until needed

  fixedQueryType: FixedQueryType;
}
