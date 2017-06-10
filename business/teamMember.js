//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

const common = require('./common');

const githubEntityClassification = require('../data/github-entity-classification.json');
const memberPrimaryProperties = githubEntityClassification.member.keep;
const memberSecondaryProperties = githubEntityClassification.member.strip;

class TeamMember {
  constructor(team, entity, getToken, operations) {
    this.team = team;

    if (entity) {
      common.assignKnownFields(this, entity, 'member', memberPrimaryProperties, memberSecondaryProperties);
    }

    const privates = _private(this);
    privates.getToken = getToken;
    privates.operations = operations;
  }

  resolveDirectLink(callback) {
    // This method was added to directly attach a link instance
    // equivalent to the legacy implementation of team mgmt.
    // Consider a better design...
    const operations = _private(this).operations;
    operations.graphManager.getCachedLink(this.id, (getLinkError, link) => {
      if (getLinkError) {
        return callback(getLinkError);
      }
      this.link = link;
      return callback(null, link);
    });
  }
}

module.exports = TeamMember;

const privateSymbol = Symbol();
function _private(self) {
  if (self[privateSymbol] === undefined) {
    self[privateSymbol] = {};
  }
  return self[privateSymbol];
}
