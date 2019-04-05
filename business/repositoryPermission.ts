//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

import * as common from './common';
import { Operations } from "./operations";
import { Organization } from "./organization";

const repoPermissionProperties = [
  'permission',
  'user',
];

export class RepositoryPermission {
  private _organization: Organization;
  private _operations: Operations;
  private _getToken: any;

  private _id: string;
  private _user: any;

  constructor(organization: Organization, entity, getToken, operations: Operations) {
    this._organization = organization;

    if (entity) {
      common.assignKnownFieldsPrefixed(this, entity, 'repositoryPermission', repoPermissionProperties);
      if (this._user) {
        this._id = this._user.id;
      }
    }

    this._getToken = getToken;
    this._operations = operations;
  }
}
