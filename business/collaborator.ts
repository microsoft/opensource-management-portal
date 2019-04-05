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

export class Collaborator {
  public static PrimaryProperties = memberPrimaryProperties;

  private _organization: Organization;
  private _operations: Operations;
  private _getToken: any;

  private _avatar_url: string;
  private _id: string;
  private _login: string;
  private _permissions: any;

  constructor(organization: Organization, entity, getToken, operations: Operations) {
    this._organization = organization;

    if (entity) {
      common.assignKnownFieldsPrefixed(this, entity, 'member', memberPrimaryProperties);
    }

    this._getToken = getToken;
    this._operations = operations;
  }

  get permissions(): any {
    return this._permissions;
  }

  get id(): string {
    return this._id;
  }

  get login(): string {
    return this._login;
  }

  get avatar_url(): string {
    return this._avatar_url;
  }
}
