//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

export type ConfigRootCampaigns = {
  campaigns: ConfigCampaigns;
};

export type ConfigCampaigns = {
  provider: string;

  groups: string;

  cosmosdb: {
    endpoint: string;
    database: string;
    collection: string;
    key?: string;
    useManagedIdentity: boolean;
  };
};
