//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

const common = require('./common');

const githubEntityClassification = require('../data/github-entity-classification.json');
const memberPrimaryProperties = githubEntityClassification.member.keep;

class Collaborator {
  constructor(organization, entity, getToken, operations) {
    this.organization = organization;

    if (entity) {
      common.assignKnownFields(this, entity, 'member', memberPrimaryProperties);
    }

    const privates = _private(this);
    privates.getToken = getToken;
    privates.operations = operations;
  }
}

module.exports = Collaborator;

const privateSymbol = Symbol();
function _private(self) {
  if (self[privateSymbol] === undefined) {
    self[privateSymbol] = {};
  }
  return self[privateSymbol];
}
