//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

import * as common from './common';

const memberPrimaryProperties = [
  'id',
  'login',
  'permissions',
  'avatar_url',
];

export class Collaborator {
  public static PrimaryProperties = memberPrimaryProperties;

  private _avatar_url: string;
  private _id: number;
  private _login: string;
  private _permissions: any;

  constructor(entity: unknown) {
    if (entity) {
      common.assignKnownFieldsPrefixed(this, entity, 'member', memberPrimaryProperties);
    }
  }

  get permissions(): any {
    return this._permissions;
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
}
