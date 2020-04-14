//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

import * as common from './common';
import { Organization } from "./organization";
import { Operations } from "./operations";
import { GetAddressFromUpnAsync } from '../lib/mailAddressProvider';

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
  private _organizationProfile: any;
  private _id: number;
  private _login: string;
  private _updated_at;
  private _created_at;
  private _avatar_url;
  private _permissions;
  private _entity;

  constructor(organization: Organization, entity: any, operations: Operations) {
    this._organization = organization;
    if (entity) {
      common.assignKnownFieldsPrefixed(this, entity, 'member', memberPrimaryProperties, memberSecondaryProperties);
      this._entity = entity;
    }
    // Organization accounts have a plan
    if (entity && entity.plan) {
      this._organizationProfile = entity;
    }
    this._operations = operations;
  }

  getEntity() {
    return this._entity;
  }

  getProfileCreatedDate(): Date {
    // legacy method that should probably be removed
    if (this._created_at) {
      return new Date(this._created_at);
    }
  }

  getProfileUpdatedDate(): Date {
    // legacy method that should probably be removed
    if (this._updated_at) {
      return new Date(this._updated_at);
    }
  }

  get organizationProfile() {
    return this._organizationProfile;
  }

  get id(): number {
    return this._id;
  }

  get login(): string {
    return this._login;
  }

  get avatar_url(): string {
    return this._avatar_url;
  }

  get permissions(): any {
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

  async getMailAddress(): Promise<string> {
    // duplicated code in organizationMember and teamMember
    if (!this._id) {
      throw new Error('No organization member ID');
    }
    const link = await this._operations.getLinkByThirdPartyId(this._id.toString());
    if (!link || !link.corporateId) {
      throw new Error(`Organization member ID ${this._id} is not linked.`);
    }
    if (!link.corporateUsername) {
      throw new Error(`Organization member ID ${this._id} is linked to corporate ID ${link.corporateId} but does not have a corporate username.`);
    }
    const providers = this._operations.providers;
    if (!providers.mailAddressProvider) {
      throw new Error('No mailAddressProvider is available in this application instance');
    }
    return GetAddressFromUpnAsync(providers.mailAddressProvider, link.corporateUsername);
  }
}
