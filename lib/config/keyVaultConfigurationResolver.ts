//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { ClientSecretCredential } from '@azure/identity';
import { KeyVaultSecret, SecretClient } from '@azure/keyvault-secrets';
import objectPath from 'object-path';
import { URL } from 'url';

// Key Vault Configuration Assumptions:
// In URL syntax, we define a custom scheme of "keyvault://" which resolves
// a KeyVault secret ID, replacing the original. To use a tag (a custom
// attribute on a secret - could be a username for example), use the tag
// name as the auth parameter of the URL.
//
// For example:
//   keyvault://myCustomTag@keyvaultname.vault.azure.net/secrets/secret-value-name/secretVersion",
//
// Would resolve the "myCustomTag" value instead of the secret value.
//
// You can also chose to leave the version off, so that the most recent version
// of the secret will be resolved during the resolution process.
//
// In the case that a KeyVault secret ID is needed inside the app, and not
// handled at startup, then the secret ID (a URI) can be included without
// the custom keyvault:// scheme.
//
// Note that this use of a custom scheme called "keyvault" is not an officially
// recommended or supported approach for KeyVault use in applications, and may
// not be endorsed by the engineering team responsible for KeyVault, but for our
// group and our Node apps, it has been very helpful.

const keyVaultProtocol = 'keyvault:';
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
    throw new Error('The requested resource must be a KeyVault secret');
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

type AzureAuthenticationPair = {
  clientId: string;
  clientSecret: string;
  tenantId: string;
};

export interface IKeyVaultConfigurationOptions {
  getClientCredentials?: () => Promise<AzureAuthenticationPair>;
  getSecretClient?: (vault: string) => Promise<SecretClient>;
}

function createAndWrapKeyVaultClient(options: IKeyVaultConfigurationOptions) {
  if (!options) {
    throw new Error('No options provided for the key vault resolver.');
  }
  const vaultToClient = new Map<string, SecretClient>();
  let cachedOptions: AzureAuthenticationPair = null;
  let cachedCredentials = null;
  const getSecretClient =
    options.getSecretClient ||
    (async (vault: string) => {
      if (!cachedOptions) {
        cachedOptions = await options.getClientCredentials();
        cachedCredentials = new ClientSecretCredential(
          cachedOptions.tenantId,
          cachedOptions.clientId,
          cachedOptions.clientSecret
        );
      }
      let client = vaultToClient.get(vault);
      if (!client) {
        client = new SecretClient(vault, cachedCredentials);
        vaultToClient.set(vault, client);
      }
      return client;
    });
  return {
    getObjectSecrets: function (object: any) {
      return getSecretsFromVault(getSecretClient, object);
    },
  };
}

type VaultSettings = {
  tag: string;
  uri: string;
};

async function getSecretsFromVault(getSecretClient: (vault: string) => Promise<SecretClient>, object: any) {
  let paths = null;
  try {
    paths = identifyKeyVaultValuePaths(object);
  } catch (parseError) {
    throw parseError;
  }
  // Build a unique list of secrets, fetch them at once
  try {
    const uniqueUris = new Set<string>();
    const pathProperties = new Map<string, VaultSettings>();
    const uniqueUriToVault = new Map<string, string>();
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
    const secretStash = new Map<string, KeyVaultSecret>();
    const uniques = Array.from(uniqueUris.values());
    for (const uniqueSecretId of uniques) {
      try {
        let value = secretStash.get(uniqueSecretId);
        if (!value) {
          const vaultUrl = uniqueUriToVault.get(uniqueSecretId);
          const secretClient = await getSecretClient(vaultUrl);
          const value = await getSecret(secretClient, secretStash, uniqueSecretId);
          secretStash.set(uniqueSecretId, value);
        }
      } catch (resolveSecretError) {
        // console.warn(`Error resolving secret with ID ${uniqueSecretId}: ${resolveSecretError}`);
        throw resolveSecretError;
      }
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
    console.warn(error);
    throw error;
  }
}

export default createAndWrapKeyVaultClient;
