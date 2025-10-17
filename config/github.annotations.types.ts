//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

export type ConfigGitHubRootAnnotations = {
  annotations: ConfigGitHubAnnotations;
};

export type ConfigGitHubAnnotations = {
  enabled: boolean;
  securityGroups: {
    writers: string;
    readers: string;
  };
};
