//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

class TeamRepositoryPermission {
  constructor(team, entity, getToken, operations) {
    this.team = team;

    this.permissions = entity.permissions;
    this.repository = team.organization.repositoryFromEntity(entity);

    this.id = this.repository.id;

    const privates = _private(this);
    privates.getToken = getToken;
    privates.operations = operations;
  }

  get name() {
    return this.repository.name;
  }
}

module.exports = TeamRepositoryPermission;

const privateSymbol = Symbol();
function _private(self) {
  if (self[privateSymbol] === undefined) {
    self[privateSymbol] = {};
  }
  return self[privateSymbol];
}
