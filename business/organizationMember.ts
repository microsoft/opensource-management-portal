//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

import * as common from './common';
import { Organization } from "./organization";
import { Operations } from "./operations";

const memberPrimaryProperties = [
  'id',
  'login',
  'permissions',
  'avatar_url',
];
const memberSecondaryProperties = [];

export class OrganizationMember {
  private _organization: Organization;
  private _operations: Operations;
  private _getToken: any;
  private _organizationProfile: any;
  private _id;
  private _login;
  private _updated_at;
  private _created_at;
  private _avatar_url;
  private _permissions;

  constructor(organization: Organization, entity, getToken, operations: Operations) {
    this._organization = organization;

    if (entity) {
      common.assignKnownFieldsPrefixed(this, entity, 'member', memberPrimaryProperties, memberSecondaryProperties);
    }

    // Organization accounts have a plan
    if (entity && entity.plan) {
      this._organizationProfile = entity;
    }

    this._getToken = getToken;
    this._operations = operations;
  }

  getProfileCreatedDate() {
    // legacy method that should probably be removed
    if (this._created_at) {
      return new Date(this._created_at);
    }
  }

  getProfileUpdatedDate() {
    // legacy method that should probably be removed
    if (this._updated_at) {
      return new Date(this._updated_at);
    }
  }

  get organizationProfile() {
    return this._organizationProfile;
  }

  get id() {
    return this._id;
  }

  get login() {
    return this._login;
  }

  get avatar_url() {
    return this._avatar_url;
  }

  get permissions() {
    return this._permissions;
  }

  // ----------------------------------------------------------------------------
  // Retrieves the URL for the user's avatar, if present. If the user's details
  // have not been loaded, we will not yet have an avatar URL.
  // ----------------------------------------------------------------------------
  avatar(optionalSize) {
    if (!optionalSize) {
      optionalSize = 80;
    }
    if (this._avatar_url) {
      return this._avatar_url + '&s=' + optionalSize;
    }
  }

  getMailAddress(callback) {
    // duplicated code in organizationMember and teamMember
    if (!this._id) {
      return callback(new Error('No organization member ID'));
    }
    const operations = this._operations;
    operations.graphManager.getCachedLink(this._id, (getLinkError, link) => {
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
