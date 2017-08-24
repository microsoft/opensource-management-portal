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

    // Organization accounts have a plan
    if (entity && entity.plan) {
      this.organizationProfile = entity;
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

  getMailAddress(callback) {
    // duplicated code in organizationMember and teamMember
    if (!this.id) {
      return callback(new Error('No organization member ID'));
    }
    const operations = _private(this).operations;
    operations.graphManager.getCachedLink(this.id, (getLinkError, link) => {
      if (getLinkError || !link || !link.aadupn) {
        return callback(getLinkError);
      }
      const providers = operations.providers;
      if (!providers.mailAddressProvider) {
        return callback(new Error('No mailAddressProvider is available in this application instance'));
      }
      providers.mailAddressProvider.getAddressFromUpn(link.aadupn, callback);
    });
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
