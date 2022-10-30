//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

export type ConfigGitHubRootTeams = {
  teams: ConfigGitHubTeams;
};

export type ConfigGitHubTeams = {
  maximumMembersToAllowUpgrade: number;
  maximumMaintainersToAllowUpgrade: number;
};
