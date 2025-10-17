//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

export type EntraAuthCodeUrlParameters = {
  scopes: string[];
  redirectUri: string;
  state: string;
  nonce: string;
  prompt?: string;
  loginHint?: string;
  domainHint?: string;
  // claims?: string;
};

export type EntraSessionAugmentation = {
  nonce?: string;
  state?: string;
};

export type PassportUserWithEntraID = {
  azure?: EntraIDUser;
};

export type EntraIDUser = {
  displayName: string;
  oid: string;
  username: string;
  tenantId: string;
};

/* cSpell:disable */
export type AadJwtJson = {
  name: string;
  oid: string;
  preferred_username: string;
  sub: string;
  tid: string;
  upn: string;
};
/* cSpell:enable */

export type AadResponseProfile = {
  _json: AadJwtJson;
  _raw: string;
  displayName: string;
  oid: string;
  sub: string;
  upn: string;
  tenantId: string;
};
