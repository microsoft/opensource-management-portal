//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

import { Operations } from "./operations";
import { Team } from "./team";
import { Repository } from "./repository";

export class TeamRepositoryPermission {
  private _team: Team;
  private _operations: Operations;
  private _permissions: any;
  private _repository: Repository;
  private _id: string; // ? number
  private _getToken: any;

  constructor(team: Team, entity, getToken, operations: Operations) {
    this._team = team;

    this._permissions = entity.permissions;
    this._repository = team.organization.repositoryFromEntity(entity);

    this._id = this._repository.id;

    this._getToken = getToken;
    this._operations = operations;
  }

  get team(): Team {
    return this._team;
  }

  get repository(): Repository {
    return this._repository;
  }

  get id(): string {
    return this._id;
  }

  get permissions(): any {
    return this._permissions;
  }

  get name(): string {
    return this._repository.name;
  }
}
