//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import util from 'util';

import { Organization } from './organization';
import { TeamMember } from './teamMember';
import { Team } from '.';
import {
  type IOperationsInstance,
  GitHubTeamPrivacy,
  TeamJsonFormat,
  type IGetMembersOptions,
  GitHubRepositoryPermission,
  type IGitHubTeamBasics,
} from '../interfaces';
import { projectCollaboratorPermissionsObjectToGitHubRepositoryPermission } from '../lib/transitional';

export interface ITeamRepositoryPermission {
  pull: boolean;
  triage: boolean;
  push: boolean;
  maintain: boolean;
  admin: boolean;
}

export function isStandardGitHubTeamPermission(val: string | GitHubRepositoryPermission) {
  switch (val) {
    case GitHubRepositoryPermission.Pull:
    case GitHubRepositoryPermission.Triage:
    case GitHubRepositoryPermission.Push:
    case GitHubRepositoryPermission.Maintain:
    case GitHubRepositoryPermission.Admin:
      return true;
    default:
      return false;
  }
}

type TeamPermissionIncomingEntity = {
  name: string;
  id: number;
  // node_id: we remove this currently
  slug: string;
  description: string;
  privacy: GitHubTeamPrivacy;
  permission: GitHubRepositoryPermission | string;
  permissions: ITeamRepositoryPermission;
  parent: IGitHubTeamBasics;
};

export class TeamPermission {
  // private _operations: IOperationsInstance;
  private _organization: Organization;

  private _team: Team;

  private _permission: GitHubRepositoryPermission | string;
  private _privacy: GitHubTeamPrivacy;

  private _teamMembersIfSet: TeamMember[];

  private _entity: TeamPermissionIncomingEntity;

  [util.inspect.custom](depth, options) {
    return `GitHub Team Permission: team=${this.team?.slug || this.team?.id} permission=${this._permission}`;
  }

  asJson() {
    const members = this._teamMembersIfSet;
    return {
      permission: this._permission,
      privacy: this._privacy,
      team: this._team?.asJson(TeamJsonFormat.Augmented),
      members: members ? members.map((member) => member.asJson()) : undefined,
    };
  }

  get permission(): string | GitHubRepositoryPermission {
    return this._permission;
  }

  get privacy(): GitHubTeamPrivacy {
    return this._privacy;
  }

  get team(): Team {
    return this._team;
  }

  constructor(
    organization: Organization,
    entity: TeamPermissionIncomingEntity,
    operations: IOperationsInstance
  ) {
    this._organization = organization;
    this._entity = entity;

    this._permission = entity.permission;
    this._privacy = entity.privacy;

    if (!entity || !entity.id) {
      throw new Error('TeamPermission requires entity.id');
    }
    const id = entity.id;
    this._team = organization.team(id, entity);

    // this._operations = operations;
  }

  get relativeJoinLink() {
    return this.relativePortalLink + 'join';
  }

  get relativePortalLink() {
    return `/${this._organization.name}/teams/${this._team.slug || this._team.name}/`;
  }

  get members(): TeamMember[] {
    if (this._teamMembersIfSet) {
      return this._teamMembersIfSet;
    }
  }

  get customRoleName() {
    if (!isStandardGitHubTeamPermission(this._entity.permission)) {
      return this._entity.permission;
    }
  }

  get permissions(): ITeamRepositoryPermission {
    return this._entity.permissions;
  }

  getAsPermission(): GitHubRepositoryPermission {
    return projectCollaboratorPermissionsObjectToGitHubRepositoryPermission(this._entity.permissions);
  }

  async resolveTeamMembers(options?: IGetMembersOptions): Promise<void> {
    this._teamMembersIfSet = await this.team.getMembers(options);
  }
}
