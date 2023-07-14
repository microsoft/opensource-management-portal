//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import {
  GitHubTeamRole,
  OrganizationMembershipRole,
  GitHubCollaboratorType,
  GitHubRepositoryPermission,
} from '.';
import { Team, Repository, Organization } from '../business';
import { RepositoryCacheEntity } from '../entities/repositoryCache/repositoryCache';
import { RepositoryCollaboratorCacheEntity } from '../entities/repositoryCollaboratorCache/repositoryCollaboratorCache';
import { RepositoryTeamCacheEntity } from '../entities/repositoryTeamCache/repositoryTeamCache';
import { TeamCacheEntity } from '../entities/teamCache/teamCache';
import { TeamMemberCacheEntity } from '../entities/teamMemberCache/teamMemberCache';

export enum QueryCacheOperation {
  New = 'new',
  Update = 'update',
  Delete = 'delete',
}

export interface IQueryCacheTeamMembership {
  team: Team;
  role: GitHubTeamRole;
  // debug aides:
  cacheEntity: TeamMemberCacheEntity;
  userId: string;
  login: string;
}

export interface IQueryCacheTeam {
  team: Team;
  cacheEntity: TeamCacheEntity;
}

export interface IQueryCacheRepository {
  repository: Repository;
  cacheEntity: RepositoryCacheEntity;
}

export interface IQueryCacheOrganizationMembership {
  organization: Organization;
  role: OrganizationMembershipRole;
  // debug aides:
  // cacheEntity: OrganizationMemberCacheEntity;
  userId: string;
}

export interface IQueryCacheRepositoryCollaborator {
  repository: Repository;
  affiliation: GitHubCollaboratorType;
  permission: GitHubRepositoryPermission;
  // debug aides:
  cacheEntity: RepositoryCollaboratorCacheEntity;
  userId: string;
}

export interface IQueryCacheTeamRepositoryPermission {
  repository: Repository;
  team: Team;
  permission: GitHubRepositoryPermission;
  cacheEntity: RepositoryTeamCacheEntity;
}
