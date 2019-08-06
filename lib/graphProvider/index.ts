//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

import { MicrosoftGraphProvider } from "./microsoftGraphProvider";

export interface IGraphProvider {
  getUserById(corporateId: string, callback);
  getUserByIdAsync(id: string) : Promise<any>;

  getManagerById(corporateId: string, callback);
  getUserAndManagerById(corporateId: string, callback);
}

export function CreateGraphProviderInstance(config, callback) {
  const graphConfig = config.graph;
  if (!graphConfig) {
    return callback(new Error('No graph provider configuration.'));
  }
  const provider = graphConfig.provider;
  if (!provider) {
    return callback(new Error('No graph provider set in the graph config.'));
  }
  let providerInstance: IGraphProvider = null;
  try {
    switch (provider) {
      case 'microsoftGraphProvider':
        providerInstance = new MicrosoftGraphProvider(graphConfig);
        break;
      default:
        break;
    }
  } catch (createError) {
    return callback(createError);
  }

  if (!providerInstance) {
    return callback(new Error(`The graph provider "${provider}" is not implemented or configured at this time.`));
  }

  return callback(null, providerInstance);
};
