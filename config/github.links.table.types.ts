//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

export type ConfigGitHubLinksRootTable = {
  table: ConfigGitHubLinksTable;
};

export type ConfigGitHubLinksTable = {
  account: string;
  key: string;
  prefix: string;
  encryption: boolean;
  encryptionKeyId: string;
};
