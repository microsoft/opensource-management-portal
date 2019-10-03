//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

import { IProviders } from "../../transitional";
import { ILinkProvider } from "./postgres/postgresLinkProvider";

const linkProviders = [
  'memory',
  'postgres',
  'table',
];

const defaultProviderName = 'memory';

export interface ILinkProviderCreateOptions
{
  providers: IProviders;
  config: any;
  overrideProviderType?: string;
}

export async function createAndInitializeLinkProviderInstance(providers, config, overrideProviderType?: string): Promise<ILinkProvider> {
  return new Promise<any>((resolve, reject) => {
    const linkProviderOptions : ILinkProviderCreateOptions = {
      providers,
      config,
    };
    if (overrideProviderType) {
      linkProviderOptions.overrideProviderType = overrideProviderType;
    }
    createLinkProviderInstance(linkProviderOptions, (err, provider: ILinkProvider) => {
      if (err) {
        return reject(err);
      }
      return provider.initialize(providerInitializationError => {
        if (providerInitializationError) {
          return reject(providerInitializationError);
        }
        return resolve(provider);
      });
    });
  });
}

export function createLinkProviderInstance(linkProviderCreateOptions: ILinkProviderCreateOptions, callback) {
  const config = linkProviderCreateOptions.config;
  const providers = linkProviderCreateOptions.providers;
  const provider = linkProviderCreateOptions.overrideProviderType || config.github.links.provider.name || defaultProviderName;
  // FUTURE: should also include a parameter for "what kind of third-party", i.e. 'github' to create
  let found = false;
  linkProviders.forEach(supportedProvider => {
    if (supportedProvider === provider) {
      found = true;
      let providerInstance = null;
      try {
        providerInstance = require(`./${supportedProvider}`)(providers, config);
      } catch (createError) {
        return callback(createError);
      }
      return callback(null, providerInstance);
    }
  });
  if (found === false) {
    return callback(new Error(`The link provider "${provider}" is not implemented or configured at this time.`));
  }
};
