//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

export type ConfigGitHubJobsRootCleanup = {
  cleanup: ConfigGitHubJobsCleanup;
};

export type ConfigGitHubJobsCleanup = {
  maximumInvitationAgeDays: number;
};
