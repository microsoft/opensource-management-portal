//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import type { ReposAppRequest } from '../../../interfaces/web.js';
import type { IEntraAuthorizationProperties } from '../../../interfaces/index.js';

export type EntraApiTokenValidationFunction = (
  validator: IEntraAuthorizationProperties,
  req: ReposAppRequest
) => Promise<EntraApiTokenValidateResponse>;

export type EntraApiTokenValidateResponse = {
  validator: string;
  audience: string;
  tenantId: string;
  clientId: string;
  objectId: string;
};

export type EntraApiTokenValidateError = Error & {
  status: number;
  message: string;
  wwwAuthenticate: string;
};
