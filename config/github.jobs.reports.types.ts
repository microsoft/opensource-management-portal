//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

export type ConfigGitHubJobsRootReports = {
  reports: ConfigGitHubJobsReports;
};

export type ConfigGitHubJobsReports = {
  enabled: boolean;
  mail: {
    enabled: boolean;
    from: string;
  };
  witnessEventKey: string;
  witnessEventReportsTimeToLiveMinutes: number;
  appRedisReportKey: string;
  dataLake: {
    enabled: boolean;
    azureStorage: {
      account: string;
      key: string;
      containerName: string;
      blobPrefix: string;
    };
  };
};
