//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import environmentConfigurationResolver from './environmentConfigurationResolver';
import multiGraphBuilder from './multiGraphBuilder';
import keyVaultConfigurationResolver from './keyVaultConfigurationResolver';
import volumeConfigurationResolver from './volumeConfigurationResolver';
import painlessConfigAsCode from './painlessConfigAsCode';

const keyVaultClientIdFallbacks: string[] = [
  // 0: the value of the KEYVAULT_CLIENT_ID_KEY variable
  'KEYVAULT_CLIENT_ID',
  'AAD_CLIENT_ID',
];

const keyVaultClientSecretFallbacks: string[] = [
  // 0: the value of KEYVAULT_CLIENT_SECRET_KEY variable
  'KEYVAULT_CLIENT_SECRET',
  'AAD_CLIENT_SECRET',
];

const keyVaultTenantFallbacks: string[] = [
  // 0: the value of KEYVAULT_TENANT_ID_KEY variable
  'KEYVAULT_TENANT_ID',
  'AAD_TENANT_ID',
];

export interface IPainlessConfigGet {
  get(name: string): string | undefined;
}

type Resolver = (object: any) => Promise<void>;

type Resolvers = Resolver[] & { environment?: IPainlessConfigGet };

export type InnerError = Error & { innerError?: Error };

export interface ILibraryOptions {
  options?: IProviderOptions;
  environment?: IPainlessConfigGet;
  graphProvider?: (optional?: any) => Promise<any>;
  resolvers?: Resolvers;
}

export interface IProviderOptions {
  provider?: IPainlessConfigGet;
  applicationName?: string;
  applicationRoot?: string;
  skipDotEnv?: boolean;
  directoryName?: string;
  moduleDirectoryName?: string;
  treatErrorsAsWarnings?: boolean;
  requireConfigurationDirectory?: boolean;
  graph?: any;
  graphProvider?: (opt?: any) => Promise<any>;
}

function createDefaultResolvers(libraryOptions: ILibraryOptions) {
  // The core environment resolver is used to make sure that the
  // right variables are used for KeyVault or other boostrapping
  const environmentProvider =
    libraryOptions.environment || painlessConfigAsCode(libraryOptions?.options);

  try {
    environmentProvider.get((null as any) as string /* hacky */); // for init
  } catch (ignoreError) {
    console.warn(ignoreError);
  }
  const environmentOptions = {
    provider: environmentProvider,
  };
  const volumeResolver = volumeConfigurationResolver(environmentOptions);
  const keyVaultOptions = {
    getClientCredentials: async () => {
      unshiftOptionalVariable(
        keyVaultClientIdFallbacks,
        environmentProvider,
        'KEYVAULT_CLIENT_ID_KEY'
      );
      unshiftOptionalVariable(
        keyVaultClientSecretFallbacks,
        environmentProvider,
        'KEYVAULT_CLIENT_SECRET_KEY'
      );
      unshiftOptionalVariable(
        keyVaultTenantFallbacks,
        environmentProvider,
        'KEYVAULT_TENANT_ID_KEY'
      );
      async function getEnvironmentOrVolumeValue(fallbacks: string[]) {
        let value = getEnvironmentValue(
          environmentProvider,
          fallbacks
        ) as string;
        const asVolumeFile = volumeResolver.isVolumeFile(value);
        if (asVolumeFile) {
          value = await volumeResolver.resolveVolumeFile(
            environmentProvider,
            asVolumeFile
          );
        }
        return value;
      }
      const clientId = await getEnvironmentOrVolumeValue(
        keyVaultClientIdFallbacks
      );
      const clientSecret = await getEnvironmentOrVolumeValue(
        keyVaultClientSecretFallbacks
      );
      const tenantId = await getEnvironmentOrVolumeValue(
        keyVaultTenantFallbacks
      );
      if (clientId && clientSecret && tenantId) {
        return {
          clientId,
          clientSecret,
          tenantId,
        };
      }
    },
  };

  const resolvers: Resolvers = [
    environmentConfigurationResolver(environmentOptions).resolveObjectVariables,
    volumeResolver.resolveVolumeFiles,
    keyVaultConfigurationResolver(keyVaultOptions).getObjectSecrets,
  ];
  resolvers.environment = environmentProvider;
  return resolvers;
}

function unshiftOptionalVariable(
  arr: string[],
  environmentProvider: IPainlessConfigGet,
  key: string
) {
  let value = environmentProvider.get(key);
  if (value) {
    arr.unshift(value);
  }
  return arr;
}

function getEnvironmentValue(
  environmentProvider: IPainlessConfigGet,
  potentialNames: string[]
) {
  for (let i = 0; i < potentialNames.length; i++) {
    const value = environmentProvider.get(potentialNames[i]);
    // Warning - false is a valid value
    if (value !== undefined && value !== null) {
      return value;
    }
  }
}

async function getConfigGraph(
  libraryOptions: ILibraryOptions,
  options: IProviderOptions,
  environmentProvider: IPainlessConfigGet
) {
  if (options.graph) {
    return options.graph;
  }
  let graphProvider =
    options.graphProvider || libraryOptions.graphProvider || multiGraphBuilder;
  if (!graphProvider) {
    throw new Error(
      'No graph provider configured for this environment: no options.graphProvider or libraryOptions.graphProvider or multiGraphBuilder'
    );
  }
  const graphLibraryApi: ILibraryOptions = {
    options,
    environment: environmentProvider,
  };
  const graph = await graphProvider(graphLibraryApi);
  return graph;
}

function initialize(libraryOptions?: ILibraryOptions) {
  libraryOptions = libraryOptions || {};
  const resolvers: Resolvers =
    libraryOptions.resolvers || createDefaultResolvers(libraryOptions);
  if (!resolvers) {
    throw new Error('No resolvers provided.');
  }
  const environmentProvider = resolvers.environment as IPainlessConfigGet;
  return {
    resolve: async function (options: IProviderOptions) {
      if (typeof options === 'function') {
        const deprecatedCallback = (options as any) as (err: Error) => void;
        return deprecatedCallback(
          new Error(
            'This library no longer supports callbacks. Please use native JavaScript promises, i.e. const config = await painlessConfigResolver.resolve();'
          )
        );
      }
      options = options || {};
      // Find, build or dynamically generate the configuration graph
      const graph = await getConfigGraph(
        (libraryOptions as any) as ILibraryOptions,
        options,
        environmentProvider
      );
      if (!graph) {
        throw new Error(
          'No configuration "graph" provided as an option to this library. Unless using a configuration graph provider, the graph option must be included.'
        );
      }
      try {
        // Synchronously, in order, resolve the graph
        for (const resolver of resolvers) {
          await resolver(graph);
        }
      } catch (resolveConfigurationError) {
        console.warn(
          `Error while resolving the graph with a resolver: ${resolveConfigurationError}`
        );
        throw resolveConfigurationError;
      }
      return graph;
    },
  };
}

initialize.resolve = function moduleWithoutInitialization(
  options: IProviderOptions
) {
  return initialize().resolve(options);
};

export default initialize;
