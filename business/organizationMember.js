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

  getMailAddress(callback) {
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
