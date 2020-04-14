//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

/*eslint no-console: ["error", { allow: ["warn"] }] */

// NOTE: this implementation is relatively temporary, with the hope that
// TypeScript may bring some sanity in the future.

'use strict';

export const CorporatePropertyNames = [
  'isServiceAccount',
  'serviceAccountMail',

  'corporateId',
  'corporateUsername',
  'corporateDisplayName',

  'thirdPartyId',
  'thirdPartyUsername',
  'thirdPartyAvatar',
];

export interface ICorporateLinkProperties {
  isServiceAccount: any;
  serviceAccountMail: any;

  corporateId: any;
  corporateUsername: any;
  corporateDisplayName: any;

  thirdPartyId: any;
  thirdPartyUsername: any;
  thirdPartyAvatar: any;
}

export interface ICorporateLink extends ICorporateLinkProperties {
  isServiceAccount: boolean;
  serviceAccountMail: string;

  corporateId: string;
  corporateUsername: string;
  corporateDisplayName: string;

  thirdPartyId: string;
  thirdPartyUsername: string;
  thirdPartyAvatar: string;
}

export interface ICorporateLinkExtended {
  internal: () => ICorporateLinkExtendedDirectMethods,
}

export interface ICorporateLinkExtendedDirectMethods {
  getDirectEntity: () => any;
}
