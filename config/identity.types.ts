//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

// TODO: this is a Microsoft-internal thing that should be moved to the company-specific section

export type ConfigRootIdentity = {
  identity: ConfigIdentity;
};

export type ConfigIdentity = {
  url: string;
  pat: string;
};
