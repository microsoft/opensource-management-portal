//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { GitHubRepositoryPermission, GitHubSimpleAccount } from '../interfaces';
import * as common from './common';
import { Repository } from './repository';

const primaryProperties = ['inviter', 'invitee', 'permissions', 'created_at', 'html_url', 'node_id'];

export type RepositoryInvitationClientJson = {
  inviter: {
    id: number;
    login: string;
  };
  invitee: {
    id: number;
    login: string;
  };
  permissions: GitHubRepositoryPermission;
  created_at: string;
  html_url: string;
  // node_id: string;
};

export class RepositoryInvitation {
  public static PrimaryProperties = primaryProperties;

  private _inviter: GitHubSimpleAccount;
  private _invitee: GitHubSimpleAccount;
  private _permissions: GitHubRepositoryPermission;
  private _html_url: string;
  private _created_at: string;

  constructor(
    private repository: Repository,
    entity: unknown
  ) {
    if (entity) {
      common.assignKnownFieldsPrefixed(this, entity, 'invitation', primaryProperties);
    }
  }

  asJson(): RepositoryInvitationClientJson {
    return {
      invitee: this.invitee,
      inviter: this.inviter,
      permissions: this.permission,
      html_url: this.invitationUrl,
      created_at: this._created_at,
    };
  }

  get permission(): GitHubRepositoryPermission {
    return this._permissions;
  }

  // getHighestPermission() {
  //   if (!this._permissions) {
  //     return GitHubRepositoryPermission.None;
  //   }
  //   return projectCollaboratorPermissionsObjectToGitHubRepositoryPermission(this._permissions);
  // }

  get inviter(): GitHubSimpleAccount {
    return this._inviter;
  }

  get invitee(): GitHubSimpleAccount {
    return this._invitee;
  }

  get invitationUrl(): string {
    return this._html_url;
  }
}
