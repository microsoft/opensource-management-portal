//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

export enum AccountJsonFormat {
  GitHub = 'github',
  UplevelWithLink = 'github+link',
}

export interface IAccountBasics {
  id: number;
  login: string;
  avatar_url: string;
  created_at: any;
  updated_at: any;
}
