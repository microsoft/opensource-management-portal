//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

const common = require('./common');

const githubEntityClassification = require('../data/github-entity-classification.json');
const memberPrimaryProperties = githubEntityClassification.member.keep;
const memberSecondaryProperties = githubEntityClassification.member.strip;

class Member {
  constructor(organization, entity, getToken, operations) {
    this.organization = organization;

    if (entity) {
      common.assignKnownFields(this, entity, 'member', memberPrimaryProperties, memberSecondaryProperties);
    }

    const privates = _private(this);
    privates.getToken = getToken;
    privates.operations = operations;
  }

  getProfileCreatedDate() {
    // legacy method that should probably be removed
    if (this.created_at) {
      return new Date(this.created_at);
    }
  }

  getProfileUpdatedDate() {
    // legacy method that should probably be removed
    if (this.updated_at) {
      return new Date(this.updated_at);
    }
  }

  // ----------------------------------------------------------------------------
  // Retrieves the URL for the user's avatar, if present. If the user's details
  // have not been loaded, we will not yet have an avatar URL.
  // ----------------------------------------------------------------------------
  avatar(optionalSize) {
    if (!optionalSize) {
      optionalSize = 80;
    }
    if (this.avatar_url) {
      return this.avatar_url + '&s=' + optionalSize;
    }
  }
}

module.exports = Member;

const privateSymbol = Symbol();
function _private(self) {
  if (self[privateSymbol] === undefined) {
    self[privateSymbol] = {};
  }
  return self[privateSymbol];
}
