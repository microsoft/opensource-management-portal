//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import CosmosSessionStore from '../../lib/cosmosSession/index.js';
import type { IProviders } from '../../interfaces/providers.js';

export async function prepareCosmosSessionMiddleware(providers: IProviders) {
  const { config } = providers;

  const cosmosStore = new CosmosSessionStore(providers, config.session.cosmosdb);
  await cosmosStore.initialize();
  providers.session = cosmosStore;
}
