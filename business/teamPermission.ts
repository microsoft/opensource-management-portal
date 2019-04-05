//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

import { Organization } from "./organization";
import { Operations } from "./operations";
import { Team } from "./team";

export class TeamPermission {
  private _organization: Organization;
  private _operations: Operations;
  private _getToken: any;

  private _team: Team;

  private _permission: any;
  private _privacy: any;

  get permission(): any {
    return this._permission;
  }

  get privacy(): any {
    return this._privacy;
  }

  get team(): Team {
    return this._team;
  }

  constructor(organization: Organization, entity, getToken, operations: Operations) {
    this._organization = organization;

    this._permission = entity.permission;
    this._privacy = entity.privacy;

    const id = entity.id;
    this._team = organization.team(id, entity);

    this._getToken = getToken;
    this._operations = operations;
  }

  get relativeJoinLink() {
    return this.relativePortalLink + 'join';
  }

  get relativePortalLink() {
    return `/${this._organization.name}/teams/${this._team.slug || this._team.name}/`;
  }
}
