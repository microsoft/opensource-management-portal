//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

export type ConfigGitHubRootWebhooks = {
  webhooks: ConfigGitHubWebhooks;
};

export type ConfigGitHubWebhooks = {
  firehoseOffline: string;
  sharedSecret: string;
  runtimeMinutes: string;
  parallelism: string;
  emptyQueueDelaySeconds: string;

  provider: string;

  serviceBus: {
    connectionString?: string;
    endpoint?: string;
    useEntraAuthentication?: boolean;
    queue: string;
  };

  azureQueues: {
    account: string;
    sas?: string;
    queue: string;
    useEntraAuthentication: boolean;
  };
};
