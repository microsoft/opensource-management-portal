//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import * as common from './common';

import {
  GitHubCollaboratorPermissionLevel,
  ConvertGitHubCollaboratorPermissionLevelToGitHubRepositoryPermission,
  GitHubRepositoryPermission,
} from '../interfaces';

// prettier-ignore
const repoPermissionProperties = [
  'permission',
  'user',
];

export class RepositoryPermission {
  private _id: string;
  private _user: any;

  private _permission: GitHubCollaboratorPermissionLevel;

  constructor(entity: unknown) {
    if (entity) {
      common.assignKnownFieldsPrefixed(this, entity, 'repositoryPermission', repoPermissionProperties);
      if (this._user) {
        this._id = this._user.id;
      }
    }
  }

  get id(): string {
    return this._id;
  }
  get permission(): GitHubCollaboratorPermissionLevel {
    return this._permission;
  }
  get user(): any {
    return this._user;
  }

  public asGitHubRepositoryPermission(): GitHubRepositoryPermission {
    return ConvertGitHubCollaboratorPermissionLevelToGitHubRepositoryPermission(this._permission);
  }
}
