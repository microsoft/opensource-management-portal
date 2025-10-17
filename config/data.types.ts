//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import type { ConfigDataRootPostgres } from './data.postgres.types.js';

export type ConfigRootData = {
  data: ConfigData;
};

export type ConfigData = ConfigDataRootPostgres;
