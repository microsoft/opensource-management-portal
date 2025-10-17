//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

// This file is almost a clone of managedIdentityKeyVault.ts.

import Debug from 'debug';
import { AzureCliCredential, TokenCredential } from '@azure/identity';
import { KeyVaultSecret, SecretClient } from '@azure/keyvault-secrets';
import objectPath from 'object-path';
import { URL } from 'url';

import { CreateError } from '../transitional.js';
import type { IPainlessConfigGet } from './index.js';

const debug = Debug.debug('config');
const startupDebug = Debug.debug('startup');

const keyVaultProtocol = 'azure-cli-keyvault:';
const httpsProtocol = 'https:';
const secretsPath = '/secrets/';

async function getSecret(
  secretClient: SecretClient,
  secretStash: Map<string, KeyVaultSecret>,
  secretId: string
) {
  const cached = secretStash.get(secretId);
  if (cached) {
    return cached;
  }
  const secretUrl = new URL(secretId);
  const i = secretUrl.pathname.indexOf(secretsPath);
  if (i < 0) {
    throw new Error('The requested resource must be a Key Vault secret');
  }
  let secretName = secretUrl.pathname.substr(i + secretsPath.length);
  let version = '';
  const versionIndex = secretName.indexOf('/');
  if (versionIndex >= 0) {
    version = secretName.substr(versionIndex + 1);
    secretName = secretName.substr(0, versionIndex);
  }
  try {
    const secretResponse = await secretClient.getSecret(secretName, { version: version || undefined });
    secretStash.set(secretId, secretResponse);
    return secretResponse;
  } catch (keyVaultValidationError) {
    throw keyVaultValidationError;
  }
}

function getUrlIfVault(value) {
  try {
    const keyVaultUrl = new URL(value);
    if (keyVaultUrl.protocol === keyVaultProtocol) {
      return keyVaultUrl;
    }
  } catch (typeError) {
    /* ignore */
  }
  return undefined;
}

function getAsAzureCliIdentityPointer(value: string) {
  if (value?.startsWith && value.startsWith(keyVaultProtocol) && getUrlIfVault(value)) {
    return value;
  }
}

function identifyKeyVaultValuePaths(node: any, prefix?: string) {
  prefix = prefix !== undefined ? prefix + '.' : '';
  const paths = {};
  for (const property in node) {
    const value = node[property];
    if (typeof value === 'object') {
      Object.assign(paths, identifyKeyVaultValuePaths(value, prefix + property));
      continue;
    }
    if (typeof value !== 'string') {
      continue;
    }
    const keyVaultUrl = getUrlIfVault(value);
    if (keyVaultUrl === undefined) {
      continue;
    }
    paths[prefix + property] = keyVaultUrl;
  }
  return paths;
}

export type AzureCliKeyVaultConfigurationMethods = {
  getAdditionalTenantIds?: () => Promise<string[]>;
  environmentProvider?: IPainlessConfigGet;
};

export type AzureCliKeyVaultConfigurationOptions = AzureCliKeyVaultConfigurationMethods & {
  getSecretClient?: (vault: string) => Promise<SecretClient>;
};

export function azureCliKeyVaultConfigurationResolver(options: AzureCliKeyVaultConfigurationOptions) {
  if (!options) {
    throw new Error('No options provided for the managed identity key vault resolver.');
  }
  const vaultToClient = new Map<string, SecretClient>();
  let cachedCredentials: TokenCredential = null;
  //
  const uniqueUris = new Set<string>();
  const pathProperties = new Map<string, VaultSettings>();
  const uniqueUriToVault = new Map<string, string>();
  const secretStash = new Map<string, KeyVaultSecret>();
  const secretUrlToVaultUrl = (secretUrl: string) => {
    const value = new URL(secretUrl);
    // const tag = value.username;
    value.protocol = httpsProtocol;
    value.username = '';
    const vaultUrl = `https://${value.hostname}`;
    const uri = value.toString(); // url.format(value);
    return { vaultUrl, uri };
  };
  const getSecretValue = async (secretUrl: string) => {
    let uri: string;
    try {
      const { vaultUrl, uri: uniqueSecretId } = secretUrlToVaultUrl(secretUrl);
      uri = uniqueSecretId;
      let value = secretStash.get(uniqueSecretId);
      if (!value) {
        const secretClient = await getSecretClient(vaultUrl);
        value = await getSecret(secretClient, secretStash, uniqueSecretId);
        debug(`Retrieved secret ${uniqueSecretId} value via Azure CLI identity`);
        secretStash.set(uniqueSecretId, value);
      }
      return value?.value;
    } catch (resolveSecretError) {
      debug(`Issue retrieving secret ${uri || '[UNKNOWN]'} value via Azure CLI identity`);
      throw resolveSecretError;
    }
  };
  let configuredEnvironmentVariables: string[] = [];
  const getSecretsFromVault = async (
    getSecretClient: (vault: string) => Promise<SecretClient>,
    object: any
  ) => {
    let paths: Record<string, URL> = null;
    try {
      paths = identifyKeyVaultValuePaths(object);
    } catch (parseError) {
      throw parseError;
    }
    const configuredUrls = Object.values(paths);
    configuredEnvironmentVariables = Array.from(new Set(configuredUrls)).map((url) => url.toString());
    // Build a unique list of secrets, fetch them at once
    try {
      for (const path in paths) {
        const value = paths[path] as URL;
        const tag = value.username;
        value.protocol = httpsProtocol;
        value.username = '';
        const vaultUrl = `https://${value.hostname}`;
        const uri = value.toString(); // url.format(value);
        uniqueUriToVault.set(uri, vaultUrl);
        pathProperties.set(path, { uri, tag });
        uniqueUris.add(uri);
      }
      // pre-resolve clients
      const uniqueVaults = Array.from(uniqueUriToVault.values());
      for (const vaultUrl of uniqueVaults) {
        await getSecretClient(vaultUrl);
      }
      const uniques = Array.from(uniqueUris.values());
      const errors: string[] = [];
      await Promise.all(
        uniques.map(async (uniqueSecretId) => {
          try {
            await getSecretValue(uniqueSecretId);
          } catch (error) {
            // console.warn(`Error resolving secret with ID ${uniqueSecretId}: ${resolveSecretError}`);
            errors.push(error.toString());
          }
        })
      );
      if (errors.length) {
        throw new Error(`Error resolving secrets: ${errors.join('; ')}`);
      }
      for (const path in paths) {
        const { uri, tag } = pathProperties.get(path);
        const secretResponse = secretStash.get(uri);
        let value = undefined;
        if (!tag) {
          value = secretResponse.value;
        } else if (secretResponse?.properties?.tags) {
          value = secretResponse?.properties?.tags[tag];
        }
        objectPath.set(object, path, value);
      }
    } catch (error) {
      if (error.message.includes('No MSI credential available')) {
        throw CreateError.NotAuthorized(
          `Error resolving secrets: Azure CLI-authenticating secret references are in the environment but this environment is not configured with valid Azure CLI identity:\n${configuredEnvironmentVariables.join('\n')}\n\nPlease check if you need to locally override these values.`,
          error
        );
      }
      console.warn(error);
      throw error;
    }
  };
  const getSecretClient =
    options.getSecretClient ||
    (async (vault: string) => {
      if (!cachedCredentials) {
        startupDebug(`Using Azure CLI authentication for Key Vault`);
        const additionallyAllowedTenants = options?.getAdditionalTenantIds
          ? await options.getAdditionalTenantIds()
          : undefined;
        cachedCredentials = new AzureCliCredential(
          additionallyAllowedTenants ? { additionallyAllowedTenants } : undefined
        );
      }
      let client = vaultToClient.get(vault);
      if (!client) {
        client = new SecretClient(vault, cachedCredentials);
        vaultToClient.set(vault, client);
      }
      return client;
    });
  const resolver: AzureCliKeyVaultConfigurationResolver = {
    isAzureCliPointer: getAsAzureCliIdentityPointer,
    getAzureCliSecretValue: getSecretValue,
    getObjectSecrets: function (object: any) {
      return getSecretsFromVault(getSecretClient, object);
    },
  };
  return resolver;
}

export interface AzureCliKeyVaultConfigurationResolver {
  isAzureCliPointer(value: string): string;
  getAzureCliSecretValue(secretUrl: string): Promise<string>;
  getObjectSecrets(object: any): Promise<void>;
}

type VaultSettings = {
  tag: string;
  uri: string;
};
