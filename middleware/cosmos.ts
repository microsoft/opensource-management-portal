//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { CosmosClient } from '@azure/cosmos';

import { CreateError } from '../lib/transitional.js';
import {
  getEntraApplicationUserAssignedIdentity,
  getEntraApplicationUserAssignedIdentityCredential,
} from '../lib/applicationIdentity.js';

import type { IProviders } from '../interfaces/providers.js';

export type CosmosOptions = {
  endpoint: string;
  key?: string;
  useManagedIdentity: boolean;
};

const mapEndpointToClient = new Map<string, CosmosClient>();

export async function getOrCreateCosmosClient(
  providers: IProviders,
  options: CosmosOptions
): Promise<CosmosClient> {
  const { config } = providers;
  const { endpoint, useManagedIdentity, key } = options;
  if (!endpoint) {
    throw CreateError.InvalidParameters('options.endpoint required');
  }
  if (!key && !useManagedIdentity) {
    throw CreateError.InvalidParameters('options.key required when not using Managed Identity');
  }
  let unique: string;
  if (key) {
    unique = `${endpoint}|key`;
  } else {
    const clientId = getEntraApplicationUserAssignedIdentity(config);
    unique = `${endpoint}|${clientId}`;
  }

  if (mapEndpointToClient.has(unique)) {
    return mapEndpointToClient.get(unique)!;
  }

  if (useManagedIdentity) {
    const aadCredentials = getEntraApplicationUserAssignedIdentityCredential(config, true);
    const client = new CosmosClient({ endpoint, aadCredentials });
    mapEndpointToClient.set(unique, client);
    return client;
  }

  const client = new CosmosClient({ endpoint, key });
  mapEndpointToClient.set(unique, client);
  return client;
}
