//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import type { ConfigGitHubJobsRootCleanup } from './github.jobs.cleanup.types';
import type { ConfigGitHubJobsRootReports } from './github.jobs.reports.types';

export type ConfigGitHubRootJobs = {
  jobs: ConfigGitHubJobs;
};

export type ConfigGitHubJobs = ConfigGitHubJobsRootCleanup & ConfigGitHubJobsRootReports;
