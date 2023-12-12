//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import * as common from './common';

import {
  GitHubCollaboratorPermissionLevel,
  ConvertGitHubCollaboratorPermissionLevelToGitHubRepositoryPermission,
  GitHubRepositoryPermission,
  IGitHubCollaboratorPermissions,
} from '../interfaces';
import type { CollaboratorAccount, CollaboratorJson } from './collaborator';

// prettier-ignore
const repoPermissionProperties = [
  'permission',
  'user',
  'role_name',
];

export class RepositoryPermission {
  private _id: number;
  private _user: CollaboratorAccount;
  private _role_name: string;

  private _permission: GitHubCollaboratorPermissionLevel;

  constructor(entity: unknown) {
    if (entity) {
      common.assignKnownFieldsPrefixed(this, entity, 'repositoryPermission', repoPermissionProperties);
      if (this._user) {
        this._id = this._user.id;
      }
    }
  }

  get id(): number {
    return this._id;
  }

  get roleName(): string {
    return this._role_name;
  }

  get permission(): GitHubCollaboratorPermissionLevel {
    return this._permission;
  }

  get user(): CollaboratorAccount {
    return this._user;
  }

  asCollaboratorJson(): CollaboratorJson {
    return {
      avatar_url: null,
      id: this._id,
      login: this._user?.login,
      permissions: this.asCollaboratorPermissions(),
    };
  }

  asCollaboratorPermissions(): IGitHubCollaboratorPermissions {
    return repositoryPermissionToPermissionsObject(this.asGitHubLegacyRepositoryPermission());
  }

  asGitHubLegacyRepositoryPermission(): GitHubRepositoryPermission {
    // GitHub's API will only return "admin", "read", "write"; while the function
    // implements recognition of maintain, etc., it isn't a thing.
    return ConvertGitHubCollaboratorPermissionLevelToGitHubRepositoryPermission(this._permission);
  }

  hasCustomRolePermission() {
    switch (this._role_name) {
      case GitHubRepositoryPermission.Admin:
      case GitHubRepositoryPermission.Maintain:
      case GitHubRepositoryPermission.Triage:
      case GitHubRepositoryPermission.Push:
      case GitHubRepositoryPermission.Pull:
        return false;
      default:
        return true;
    }
  }

  interpretRoleAsDetailedPermission(): GitHubRepositoryPermission {
    if (!this.hasCustomRolePermission()) {
      return this._role_name as GitHubRepositoryPermission;
    }
    return this.asGitHubLegacyRepositoryPermission();
  }
}

export function repositoryPermissionToPermissionsObject(
  permission: GitHubRepositoryPermission
): IGitHubCollaboratorPermissions {
  const permissions: IGitHubCollaboratorPermissions = {
    admin: false,
    maintain: false,
    push: false,
    triage: false,
    pull: false,
  };
  if (permission === GitHubRepositoryPermission.Admin) {
    permissions.admin = true;
  }
  if (permission === GitHubRepositoryPermission.Maintain || permissions.admin === true) {
    permissions.maintain = true;
  }
  if (permission === GitHubRepositoryPermission.Push || permissions.maintain === true) {
    permissions.push = true;
  }
  if (permission === GitHubRepositoryPermission.Triage || permissions.push === true) {
    permissions.triage = true;
  }
  if (permission === GitHubRepositoryPermission.Pull || permissions.triage === true) {
    permissions.pull = true;
  }
  return permissions;
}
