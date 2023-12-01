//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

export type ConfigGitHubLinksRootPostgres = {
  postgres: ConfigGitHubLinksPostgres;
};

export type ConfigGitHubLinksPostgres = {
  tableName: string;
  githubThirdPartyName: string;
};
