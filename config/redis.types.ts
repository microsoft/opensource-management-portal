//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

export type ConfigRootRedis = {
  redis: ConfigRedis;
};

export type ConfigRedis = {
  port: string;
  host: string;
  key: string;
  ttl: number;
  prefix: string;
  tls: string;
};
