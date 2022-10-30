//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

export type ConfigRootImpersonation = {
  impersonation: ConfigImpersonation;
};

export type ConfigImpersonation = {
  corporateId: string;
  githubId: string;
};
