//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import type { ConfigClientRootFallback } from './client.fallback.blob.types';
import type { ConfigClientRootFlighting } from './client.flighting.types';

export type ConfigRootClient = {
  client: ConfigClient;
};

export type ConfigClient = ConfigClientRootFlighting & ConfigClientRootFallback;
