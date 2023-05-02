//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

export type ConfigDataRootPostgres = {
  postgres: ConfigDataPostgres;
};

export type ConfigDataPostgres = {
  host: string;
  database: string;
  user: string;
  password: string;
  ssl: boolean;
  port: number;
  connectionTimeoutMillis: number;
  max: number;
};
