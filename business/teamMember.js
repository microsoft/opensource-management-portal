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

  get contactEmail() {
    return _private(this).mailAddress || undefined;
  }

  get contactName() {
    return this.link ? this.link.aadname : undefined;
  }

  getMailAddress(callback) {
    const self = this;
    if (_private(this).mailAddress) {
      return callback(null, _private(this).mailAddress);
    }
    const operations = _private(this).operations;
    const providers = operations.providers;
    this.resolveDirectLink((error, link) => {
      if (error || !link || !link.aadupn) {
        return callback(error);
      }
      if (!providers.mailAddressProvider) {
        return callback(new Error('No mailAddressProvider is available in this application instance'));
      }
      providers.mailAddressProvider.getAddressFromUpn(link.aadupn, (getError, mailAddress) => {
        if (getError) {
          return callback(getError);
        }
        _private(self).mailAddress = mailAddress;
        return callback(null, mailAddress);
      });
    });
  }

  resolveDirectLink(callback) {
    // This method was added to directly attach a link instance
    // equivalent to the legacy implementation of team mgmt.
    // Consider a better design...
    if (this.link) {
      return callback(null, this.link);
    }
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
