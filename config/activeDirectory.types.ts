//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

export type ConfigRootActiveDirectory = {
  activeDirectory: ConfigActiveDirectory;
};

export type ConfigActiveDirectory = {
  clientId: string;
  clientSecret: string;
  tenantId: string;
  isMultiTenant: boolean;
  redirectUrl: string;
  issuer: string;
  blockGuestUserTypes: boolean;
  blockGuestSignIns: boolean;
};
