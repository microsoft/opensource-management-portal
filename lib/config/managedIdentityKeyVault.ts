//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

// USER_ASSIGNED_MANAGED_IDENTITY_CLIENT_ID: the ID of the user-assigned managed
// identity to use for secret resolution.
//
// KEYVAULT_MANAGED_IDENTITY_TYPE: managed-identity or client-assertions (managed-identity is default)
// KEY_VAULT_MANAGED_IDENTITY_ADDITIONAL_TENANTS: alternate tenants to allow for managed identity
// KEYVAULT_MANAGED_IDENTITY_DISABLED: set to true to disable this provider

import Debug from 'debug';
import { ClientSecretCredential, ManagedIdentityCredential, TokenCredential } from '@azure/identity';
import { KeyVaultSecret, SecretClient } from '@azure/keyvault-secrets';
import objectPath from 'object-path';
import { URL } from 'url';

import { CreateError } from '../transitional.js';
import { IPainlessConfigGet } from './index.js';

const debug = Debug.debug('config');
const startupDebug = Debug.debug('startup');

const keyVaultProtocol = 'managed-identity-keyvault:';
const httpsProtocol = 'https:';
const secretsPath = '/secrets/';

const DISABLE_KEY = 'KEYVAULT_MANAGED_IDENTITY_DISABLED';

export type ManagedIdentityKeyVaultTypes = 'managed-identity' | 'client-assertions';

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

function getAsManagedIdentityPointer(value: string) {
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

export type ManagedIdentityKeyVaultConfigurationMethods = {
  getManagedIdentityClientId?: () => Promise<string>;
  getManagedIdentityResolutionType?: () => Promise<ManagedIdentityKeyVaultTypes>;
  getClientAssertionsIdentifier?: () => Promise<{
    tenantId: string;
    clientId: string;
    clientSecret?: string;
  }>;
  getAdditionalTenantIds?: () => Promise<string[]>;
  environmentProvider?: IPainlessConfigGet;
};

export type ManagedIdentityKeyVaultConfigurationOptions = ManagedIdentityKeyVaultConfigurationMethods & {
  getSecretClient?: (vault: string) => Promise<SecretClient>;
};

export function managedIdentityKeyVaultConfigurationResolver(
  options: ManagedIdentityKeyVaultConfigurationOptions
) {
  if (!options) {
    throw new Error('No options provided for the managed identity key vault resolver.');
  }
  const vaultToClient = new Map<string, SecretClient>();
  let assignedClientId: string = null;
  let managedClientType: ManagedIdentityKeyVaultTypes = null;
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
        debug(`Retrieved secret ${uniqueSecretId} value via ${managedClientType}`);
        secretStash.set(uniqueSecretId, value);
      }
      return value?.value;
    } catch (resolveSecretError) {
      debug(`Issue retrieving secret ${uri || '[UNKNOWN]'} value via ${managedClientType}`);
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
    if (configuredEnvironmentVariables.length > 0 && options.environmentProvider) {
      const disabled = options.environmentProvider.get(DISABLE_KEY);
      if (disabled) {
        throw CreateError.InvalidParameters(
          `Managed Identity Key Vault configuration is disabled by environment variable ${DISABLE_KEY}. Configured variables:\n${configuredEnvironmentVariables.join('\n')}`
        );
      }
    }
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
          `Error resolving secrets: Managed Identity secrets are in the environment but this environment is not configured with valid Managed Identity:\n${configuredEnvironmentVariables.join('\n')}\n\nPlease check if you need to locally override these values.`,
          error
        );
      }
      console.warn(error);
      throw error;
    }
  };
  let managedClientShown = false;
  const getSecretClient =
    options.getSecretClient ||
    (async (vault: string) => {
      if (!managedClientType) {
        managedClientType = await options.getManagedIdentityResolutionType();
        if (managedClientType === 'client-assertions') {
          const { clientId, clientSecret, tenantId } = await options.getClientAssertionsIdentifier();
          if (!tenantId) {
            throw CreateError.ParameterRequired('managed identity client tenant id');
          }
          if (!clientId) {
            throw CreateError.ParameterRequired('managed identity client id');
          }
          if (!clientSecret) {
            throw CreateError.NotImplemented(
              'No client secret found. If you are using a client and need a secret, provide it securely in KEYVAULT_MANAGED_IDENTITY_CLIENT_SECRET. Otherwise, while technically a client secret is not required, this code path is not currently implemented. Please use a user-assigned managed identity value instead.'
            );
          }
          if (!managedClientShown) {
            startupDebug(
              `MI-KV: Using client instead of managed identity: client ID ${clientId} in tenant ${tenantId} ${clientSecret ? 'with secret' : 'without secret'}`
            );
            managedClientShown = true;
          }
          const additionallyAllowedTenants = options?.getAdditionalTenantIds
            ? await options.getAdditionalTenantIds()
            : undefined;
          cachedCredentials = new ClientSecretCredential(
            tenantId,
            clientId,
            clientSecret,
            additionallyAllowedTenants ? { additionallyAllowedTenants } : undefined
          );
          assignedClientId = clientId;
        } else {
          assignedClientId = await options.getManagedIdentityClientId();
          if (!assignedClientId) {
            throw CreateError.NotAuthorized(
              `No Managed Identity client ID configured to use for managed-identity-keyvault:// URLs. Check USER_ASSIGNED_MANAGED_IDENTITY_CLIENT_ID variable.\nConfigured variables:\n${configuredEnvironmentVariables.join('\n')}`
            );
          }
          if (assignedClientId && !managedClientShown) {
            startupDebug(`Managed Identity client ID: ${assignedClientId}`);
            managedClientShown = true;
          }
          cachedCredentials = new ManagedIdentityCredential(assignedClientId);
        }
      }
      let client = vaultToClient.get(vault);
      if (!client) {
        client = new SecretClient(vault, cachedCredentials);
        vaultToClient.set(vault, client);
      }
      return client;
    });
  return {
    isManagedIdentityPointer: getAsManagedIdentityPointer,
    getManagedIdentitySecretValue: getSecretValue,
    getObjectSecrets: function (object: any) {
      return getSecretsFromVault(getSecretClient, object);
    },
  };
}

type VaultSettings = {
  tag: string;
  uri: string;
};
