//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

export type ConfigRootSession = {
  session: ConfigSession;
};

export type ConfigSession = {
  provider: string;

  salt: string;
  name: string;
  domain: string;

  cosmosdb: {
    useManagedIdentity: boolean;
    createCollectionIfNotExist: boolean;
    endpoint: string;
    key: string;
    database: string;
    collection: string;
    ttl: number;
  };

  redis: {
    port: string;
    host: string;
    key: string;
    ttl: number;
    prefix: string;
    tls: string;
  };
};
