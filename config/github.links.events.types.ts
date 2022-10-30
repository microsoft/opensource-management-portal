//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

export type ConfigGitHubLinksRootEvents = {
  events: ConfigGitHubLinksEvents;
};

export type ConfigGitHubLinksEvents = {
  http: {
    link: string;
    unlink: string;
  };
};
