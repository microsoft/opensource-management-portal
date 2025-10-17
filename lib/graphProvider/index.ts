//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { CreateError } from '../transitional.js';
import { MicrosoftGraphProvider, MicrosoftGraphProviderOptions } from './microsoftGraphProvider.js';
import { getEntraApplicationIdentityInstance } from '../applicationIdentity.js';

import type { IProviders, SiteConfiguration } from '../../interfaces/index.js';
import type { IGraphProvider } from './types.js';

export * from './types.js';
export * from './enums.js';

export function CreateGraphProviderInstance(providers: IProviders, config: SiteConfiguration, callback) {
  const graphConfig = config.graph;
  if (!graphConfig) {
    return callback(CreateError.InvalidParameters('No graph provider configuration.'));
  }
  const provider = graphConfig.provider;
  if (!provider) {
    return callback(new Error('No graph provider set in the graph config.'));
  }
  let providerInstance: IGraphProvider = null;
  try {
    switch (provider) {
      case 'microsoftGraphProvider':
        const identity = getEntraApplicationIdentityInstance(providers, 'graph:directory');
        const options: MicrosoftGraphProviderOptions = {
          ...graphConfig,
          entraApplicationTokens: identity,
        };
        if (providers?.cacheProvider) {
          options.cacheProvider = providers.cacheProvider;
        }
        providerInstance = new MicrosoftGraphProvider(options);
        break;
      default:
        break;
    }
  } catch (createError) {
    return callback(createError);
  }

  if (!providerInstance) {
    return callback(
      new Error(`The graph provider "${provider}" is not implemented or configured at this time.`)
    );
  }

  return callback(null, providerInstance);
}
