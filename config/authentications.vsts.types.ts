//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

export type ConfigRootAuthenticationVsts = {
  vsts: ConfigAuthenticationVsts;
};

export type ConfigAuthenticationVsts = {
  enabled: boolean;
  vstsCollectionUrl: string;
};
