//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

export type ConfigGitHubRootCache = {
  cache: ConfigGitHubCache;
};

export type ConfigGitHubCache = {
  provider: string;
  cosmosdb: {
    endpoint: string;
    useManagedIdentity: boolean;
    key?: string;
    database: string;
    collection: string;
    blobFallback: {
      account: string;
      key: string;
      container: string;
    };
  };
  blob: {
    account: string;
    key: string;
    container: string;
  };
};
