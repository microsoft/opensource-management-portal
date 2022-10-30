//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

export type ConfigRootGraph = {
  graph: ConfigGraph;
};

export type ConfigGraph = {
  provider: string;
  require: boolean;
  tokenCacheSeconds: number;
  clientId: string;
  clientSecret: string;
  tokenEndpoint: string;
  skipManagerLookupForIds: string;
};
