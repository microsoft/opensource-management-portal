//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

export type ConfigGitHubLinksRootProvider = {
  provider: ConfigGitHubLinksProvider;
};

export type ConfigGitHubLinksProvider = {
  name: string;
  linkingOfflineMessage: string;
};
