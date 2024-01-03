//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { Team } from './team';
import { Repository } from './repository';

import type { GitHubRepositoryPermission, IOperationsInstance } from '../interfaces';
import { isStandardGitHubTeamPermission, type ITeamRepositoryPermission } from './teamPermission';
import { projectCollaboratorPermissionsObjectToGitHubRepositoryPermission } from '../lib/transitional';

// this is used when a team returns the repositories it can work with;
// the GitHub API is pretty inconsistent. The actual entities are a combination of
// repository AND permission here.

type RepositoryWithTeamPermissionsEntity = {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  description: string;
  fork: boolean;
  permissions: ITeamRepositoryPermission;
  role_name: string;
};

export class TeamRepositoryPermission {
  // private _operations: IOperationsInstance;

  private _entity: RepositoryWithTeamPermissionsEntity;

  private _team: Team;
  private _repository: Repository;
  private _id: number;

  constructor(team: Team, entity: RepositoryWithTeamPermissionsEntity, operations: IOperationsInstance) {
    this._team = team;
    if (!entity) {
      throw new Error('TeamRepositoryPermission: requires entity');
    }
    this._entity = entity;
    this._repository = team.organization.repositoryFromEntity(entity);
    this._id = this._repository.id;
  }

  asJson() {
    const repo = this._repository.asJson();
    const permissions = this.permissions;
    const combined = { ...repo, permissions };
    return combined;
  }

  get team(): Team {
    return this._team;
  }

  get repository(): Repository {
    return this._repository;
  }

  get id(): number {
    return this._id;
  }

  get customRoleName() {
    if (!isStandardGitHubTeamPermission(this._entity.role_name)) {
      return this._entity.role_name;
    }
  }

  get permissions(): ITeamRepositoryPermission {
    return this._entity.permissions;
  }

  getAsPermission(): GitHubRepositoryPermission {
    return projectCollaboratorPermissionsObjectToGitHubRepositoryPermission(this._entity.permissions);
  }

  get name(): string {
    return this._repository.name;
  }
}
