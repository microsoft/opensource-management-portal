//
// Copyright (c) Microsoft.
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
  // Key extension keys
  LocalExtensionKeysGetAll,
  // Orgs
  OrganizationMemberCacheGetAll,
  OrganizationMemberCacheByOrganizationId,
  OrganizationMemberCacheByUserId,
  // Repo cache
  RepositoryCacheGetAll,
  RepositoryCacheGetByOrganizationId,
  // Repo collaborator cache
  RepositoryCollaboratorCacheGetAll,
  RepositoryCollaboratorCacheByOrganizationId,
  RepositoryCollaboratorCacheByRepositoryId,
  RepositoryCollaboratorCacheByUserId,
  // Repository team cache
  RepositoryTeamCacheGetAll,
  RepositoryTeamCacheByRepositoryId,
  RepositoryTeamCacheByTeamId,
  RepositoryTeamCacheByTeamIds,
  RepositoryTeamCacheByOrganizationId,
  // Team cache
  TeamCacheGetAll,
  TeamCacheGetByOrganizationId,
  // Team member cache
  TeamMemberCacheGetAll,
  TeamMemberCacheGetByOrganizationId,
  TeamMemberCacheGetByUserId,
  TeamMemberCacheGetByTeamId,
  TeamMemberCacheGetByOrganizationIdAndUserId,
  // Organization settings
  OrganizationSettingsGetAll,
  OrganizationSettingsGetMostRecentlyUpdatedActive,
}

export interface IEntityMetadataFixedQuery {
  // A fixed set of query provider is less useful than a dynamic querying system
  // but also will help support a specific set of queries without too much
  // trouble or a generic query builder interface until needed

  fixedQueryType: FixedQueryType;
}
