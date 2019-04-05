//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

import * as common from './common';
import { Operations } from "./operations";
import { Team } from "./team";

const memberPrimaryProperties = [
  'id',
  'login',
  'permissions',
  'avatar_url',
];
const memberSecondaryProperties = [];

export class TeamMember {
  private _team: Team;
  private _getToken: any;
  private _operations: Operations;
  private _link: any;
  private _id: string;
  private _avatar_url: string;
  private _mailAddress: string;
  private _login: string;
  private _permissions: any;

  get team(): Team {
    return this._team;
  }

  get link(): any {
    return this._link;
  }

  get id(): string {
    return this._id;
  }

  get avatar_url(): string {
    return this._avatar_url;
  }

  get permissions(): any {
    return this._permissions;
  }

  get login(): string {
    return this._login;
  }

  set link(value: any) {
    console.log('Setter for TeamMember::link');
    this._link = value;
  }

  constructor(team: Team, entity, getToken, operations: Operations) {
    this._team = team;

    if (entity) {
      common.assignKnownFieldsPrefixed(this, entity, 'member', memberPrimaryProperties, memberSecondaryProperties);
    }

    this._getToken = getToken;
    this._operations = operations;
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

  get contactEmail() {
    return this._mailAddress || undefined;
  }

  get contactName() {
    return this._link ? this._link.aadname : undefined;
  }

  getMailAddress(callback) {
    const self = this;
    if (this._mailAddress) {
      return callback(null, this._mailAddress);
    }
    const operations = this._operations;
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
        self._mailAddress = mailAddress;
        return callback(null, mailAddress);
      });
    });
  }

  resolveDirectLink(callback) {
    // This method was added to directly attach a link instance
    // equivalent to the legacy implementation of team mgmt.
    // Consider a better design...
    if (this._link) {
      return callback(null, this._link);
    }
    const operations = this._operations;
    operations.graphManager.getCachedLink(this._id, (getLinkError, link) => {
      if (getLinkError) {
        return callback(getLinkError);
      }
      this._link = link;
      return callback(null, link);
    });
  }
}
