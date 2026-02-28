//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

export type ConfigGitHubRootOperations = {
  operations: ConfigGitHubOperations;
};

export type ConfigGitHubOperations = {
  publicAccessToken: string;
  primaryOrganizationId: number;
};
