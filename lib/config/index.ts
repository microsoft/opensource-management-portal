//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import environmentConfigurationResolver from './environmentConfigurationResolver.js';
import multiGraphBuilder from './multiGraphBuilder.js';
import keyVaultConfigurationResolver from './keyVaultConfigurationResolver.js';
import volumeConfigurationResolver from './volumeConfigurationResolver.js';
import painlessConfigAsCode from './painlessConfigAsCode.js';
import {
  ManagedIdentityKeyVaultConfigurationMethods,
  managedIdentityKeyVaultConfigurationResolver,
  ManagedIdentityKeyVaultTypes,
} from './managedIdentityKeyVault.js';
import { CreateError } from '../transitional.js';
import {
  AzureCliKeyVaultConfigurationMethods,
  AzureCliKeyVaultConfigurationResolver,
  azureCliKeyVaultConfigurationResolver,
} from './azureCliKeyVault.js';

const keyVaultClientIdFallbacks: string[] = [
  // 0: the value of the KEYVAULT_CLIENT_ID_KEY variable
  'KEYVAULT_CLIENT_ID',
  'ENTRA_APP_CLIENT_ID',
  'ENTRA_ID_CLIENT_ID',
];

const keyVaultClientSecretFallbacks: string[] = [
  // 0: the value of KEYVAULT_CLIENT_SECRET_KEY variable
  'KEYVAULT_CLIENT_SECRET',
  'ENTRA_APP_CLIENT_SECRET',
  'ENTRA_ID_CLIENT_SECRET',
];

const keyVaultTenantFallbacks: string[] = [
  // 0: the value of KEYVAULT_TENANT_ID_KEY variable
  'KEYVAULT_TENANT_ID',
  'ENTRA_APP_TENANT_ID',
  'ENTRA_ID_TENANT_ID',
];

const userAssignedManagedIdentityKey = 'USER_ASSIGNED_MANAGED_IDENTITY_CLIENT_ID';
const managedIdentityTypeKey = 'KEYVAULT_MANAGED_IDENTITY_TYPE';
const tenantIdKey = 'KEYVAULT_MANAGED_IDENTITY_TENANT_ID';
const clientIdKey = 'KEYVAULT_MANAGED_IDENTITY_CLIENT_ID';
const clientSecretKey = 'KEYVAULT_MANAGED_IDENTITY_CLIENT_SECRET';
const additionalTenantIds = 'KEY_VAULT_MANAGED_IDENTITY_ADDITIONAL_TENANTS';

const KEYVAULT_AZURE_CLI_ENABLED_KEY = 'KEYVAULT_AZURE_CLI_ENABLED';

export interface IPainlessConfigGet {
  providerName: string;
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

async function createDefaultResolvers(libraryOptions: ILibraryOptions) {
  // The core environment resolver is used to make sure that the
  // right variables are used for KeyVault or other bootstrapping
  const environmentProvider =
    libraryOptions.environment || (await painlessConfigAsCode(libraryOptions?.options));

  try {
    environmentProvider.get(null as any as string /* hacky */); // for init
  } catch (ignoreError) {
    console.warn(ignoreError);
  }
  const environmentOptions = {
    provider: environmentProvider,
  };
  const volumeResolver = volumeConfigurationResolver(environmentOptions);
  let azureCliResolver: AzureCliKeyVaultConfigurationResolver;
  if (environmentProvider.get(KEYVAULT_AZURE_CLI_ENABLED_KEY)) {
    const azureCliKeyVaultOptions: AzureCliKeyVaultConfigurationMethods = {
      environmentProvider,
      getAdditionalTenantIds: async () => {
        const additionalTenants = await getEnvironmentOrVolumeValue([additionalTenantIds]);
        return additionalTenants ? additionalTenants.split(',') : undefined;
      },
    };
    azureCliResolver = azureCliKeyVaultConfigurationResolver(azureCliKeyVaultOptions);
  }
  const managedIdentityKeyVaultOptions: ManagedIdentityKeyVaultConfigurationMethods = {
    environmentProvider,
    getManagedIdentityClientId: async () => {
      const clientId = await getEnvironmentOrVolumeValue([userAssignedManagedIdentityKey]);
      return clientId;
    },
    getManagedIdentityResolutionType: async () => {
      const resolutionType = await getEnvironmentOrVolumeValue([managedIdentityTypeKey]);
      if (resolutionType && resolutionType !== 'managed-identity' && resolutionType !== 'client-assertions') {
        throw CreateError.InvalidParameters(
          `Invalid value for ${managedIdentityTypeKey} (${resolutionType}). Must be 'managed-identity' or 'client-assertions'.`
        );
      }
      return (resolutionType || 'managed-identity') as ManagedIdentityKeyVaultTypes;
    },
    getAdditionalTenantIds: async () => {
      const additionalTenants = await getEnvironmentOrVolumeValue([additionalTenantIds]);
      return additionalTenants ? additionalTenants.split(',') : undefined;
    },
    getClientAssertionsIdentifier: async () => {
      return {
        tenantId: await getEnvironmentOrVolumeValue([tenantIdKey]),
        clientId: await getEnvironmentOrVolumeValue([clientIdKey]),
        clientSecret: await getEnvironmentOrVolumeValue([clientSecretKey]),
      };
    },
  };
  const managedIdentityResolver = managedIdentityKeyVaultConfigurationResolver(
    managedIdentityKeyVaultOptions
  );
  async function getEnvironmentOrVolumeValue(fallbacks: string[]) {
    let value = getEnvironmentValue(environmentProvider, fallbacks) as string;
    const asVolumeFile = volumeResolver.isVolumeFile(value);
    if (asVolumeFile) {
      value = await volumeResolver.resolveVolumeFile(environmentProvider, asVolumeFile);
    }
    const asManagedIdentityPointer = managedIdentityResolver.isManagedIdentityPointer(value);
    if (asManagedIdentityPointer) {
      value = await managedIdentityResolver.getManagedIdentitySecretValue(value);
    }
    if (azureCliResolver) {
      const asAzureCliPointer = azureCliResolver.isAzureCliPointer(value);
      if (asAzureCliPointer) {
        value = await azureCliResolver.getAzureCliSecretValue(value);
      }
    }
    return value;
  }
  const keyVaultOptions = {
    getClientCredentials: async () => {
      unshiftOptionalVariable(keyVaultClientIdFallbacks, environmentProvider, 'KEYVAULT_CLIENT_ID_KEY');
      unshiftOptionalVariable(
        keyVaultClientSecretFallbacks,
        environmentProvider,
        'KEYVAULT_CLIENT_SECRET_KEY'
      );
      unshiftOptionalVariable(keyVaultTenantFallbacks, environmentProvider, 'KEYVAULT_TENANT_ID_KEY');
      const clientId = await getEnvironmentOrVolumeValue(keyVaultClientIdFallbacks);
      if (!clientId) {
        throw CreateError.ParameterRequired(keyVaultClientIdFallbacks.join(' | '));
      }
      const clientSecret = await getEnvironmentOrVolumeValue(keyVaultClientSecretFallbacks);
      // if (!clientSecret) {
      //   throw CreateError.ParameterRequired(keyVaultClientSecretFallbacks.join(' | '));
      // }
      const tenantId = await getEnvironmentOrVolumeValue(keyVaultTenantFallbacks);
      if (!tenantId) {
        throw CreateError.ParameterRequired(keyVaultTenantFallbacks.join(' | '));
      }
      if (clientId && tenantId) {
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
    managedIdentityResolver.getObjectSecrets,
    azureCliResolver ? azureCliResolver.getObjectSecrets : undefined,
    keyVaultConfigurationResolver(keyVaultOptions).getObjectSecrets,
  ].filter((r) => r);
  resolvers.environment = environmentProvider;
  return resolvers;
}

function unshiftOptionalVariable(arr: string[], environmentProvider: IPainlessConfigGet, key: string) {
  const value = environmentProvider.get(key);
  if (value) {
    arr.unshift(value);
  }
  return arr;
}

function getEnvironmentValue(environmentProvider: IPainlessConfigGet, potentialNames: string[]) {
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
  const graphProvider = options.graphProvider || libraryOptions.graphProvider || multiGraphBuilder;
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

async function initialize(libraryOptions?: ILibraryOptions) {
  libraryOptions = libraryOptions || {};
  const resolvers: Resolvers = libraryOptions.resolvers || (await createDefaultResolvers(libraryOptions));
  if (!resolvers) {
    throw new Error('No resolvers provided.');
  }
  const environmentProvider = resolvers.environment as IPainlessConfigGet;
  return {
    resolve: async function (options: IProviderOptions) {
      if (typeof options === 'function') {
        const deprecatedCallback = options as any as (err: Error) => void;
        return deprecatedCallback(
          new Error(
            'This library no longer supports callbacks. Please use native JavaScript promises, i.e. const config = await painlessConfigResolver.resolve();'
          )
        );
      }
      options = options || {};
      // Find, build or dynamically generate the configuration graph
      const graph = await getConfigGraph(
        libraryOptions as any as ILibraryOptions,
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
        console.warn(`Error while resolving the graph with a resolver: ${resolveConfigurationError}`);
        throw resolveConfigurationError;
      }
      return graph;
    },
  };
}

// initialize.resolve = function moduleWithoutInitialization(options: IProviderOptions) {
//   return initialize().resolve(options);
// };

export default initialize;
