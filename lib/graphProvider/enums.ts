//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

export enum GraphUserType {
  Unknown = '', // most employees
  Guest = 'Guest',
  Member = 'Member', // some users, like LinkedIn employees, are a member
}

export enum GraphEntityType {
  User = 'user',
  Group = 'group',
}
