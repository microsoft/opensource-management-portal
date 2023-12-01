//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

export type ConfigGitHubRootApprovals = {
  approvals: ConfigGitHubApprovals;
};

export type ConfigGitHubApprovals = {
  provider: {
    name: string;
  };
};
