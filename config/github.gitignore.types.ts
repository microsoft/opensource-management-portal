//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

export type ConfigGitHubRootGitIgnore = {
  gitignore: ConfigGitHubGitIgnore;
};

export type ConfigGitHubGitIgnore = {
  default: string;
  languages: string[];
};
