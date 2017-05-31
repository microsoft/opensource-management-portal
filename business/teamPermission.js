//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

class TeamPermission {
  constructor(organization, entity, getToken, operations) {
    this.organization = organization;

    this.permission = entity.permission;
    this.privacy = entity.privacy;

    const id = entity.id;
    this.team = organization.team(id, entity);

    const privates = _private(this);
    privates.getToken = getToken;
    privates.operations = operations;
  }

  get relativeJoinLink() {
    return this.relativePortalLink + 'join';
  }

  get relativePortalLink() {
    return `/${this.organization.name}/teams/${this.team.slug || this.team.name}/`;
  }
}

module.exports = TeamPermission;

const privateSymbol = Symbol();
function _private(self) {
  if (self[privateSymbol] === undefined) {
    self[privateSymbol] = {};
  }
  return self[privateSymbol];
}
