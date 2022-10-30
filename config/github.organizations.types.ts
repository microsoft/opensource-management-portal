//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

export type ConfigGitHubRootOrganizations = {
  organizations: ConfigGitHubOrganizationsSpecializedList;
};

export type ConfigGitHubOrganization = {
  name: string;
  id: number;
  type: string;
  ownerToken: string;
  description: string;
  teamAllMembers: string; // | number
  teamPortalSudoers: string; // | number
  preventLargeTeamPermissions: boolean;
  teamAllReposRead: string; // | number
  teamAllReposWrite: string; // | number
  templates: string[];
  onboarding: boolean;
  ignore: boolean;
};

export type ConfigGitHubOrganizationsSpecializedList = ConfigGitHubOrganization[] & {
  onboarding: ConfigGitHubOrganization[];
  ignore: ConfigGitHubOrganization[];
};
