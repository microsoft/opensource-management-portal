//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { TokenCredential } from '@azure/identity';
import { BlobServiceClient, StorageSharedKeyCredential, ContainerClient } from '@azure/storage-blob';
import Debug from 'debug';

import { CreateError } from './transitional.js';
import { tryGetEntraApplicationTokenCredential } from './applicationIdentity.js';

import type { IProviders } from '../interfaces/index.js';

const debug = Debug.debug('cache');

export interface IBlobCacheOptions {
  account: string;
  key?: string;
  tokenCredential?: TokenCredential;
  container: string;
  folder?: string;
}

interface IExtendedProviders extends IProviders {
  staticBlobCacheFallback: StaticBlobCacheFallback;
}

export async function getStaticBlobCacheFallback(providers: IProviders) {
  const p = providers as IExtendedProviders;
  const { config, insights } = providers;
  if (!p.staticBlobCacheFallback && config?.client?.fallback?.blob?.account) {
    insights?.trackEvent({
      name: 'web.static_blob_cache.fallback.initializing',
      properties: {
        account: config.client.fallback.blob.account,
        container: config.client.fallback.blob.container,
      },
    });
    try {
      const tokenCredential = tryGetEntraApplicationTokenCredential(providers, 'blob:static');
      p.staticBlobCacheFallback = new StaticBlobCacheFallback({
        ...config.client.fallback.blob,
        tokenCredential,
      });
      await p.staticBlobCacheFallback.initialize();
      insights?.trackEvent({
        name: 'web.static_blob_cache.fallback.initialized',
        properties: {
          account: config.client.fallback.blob.account,
          container: config.client.fallback.blob.container,
        },
      });
    } catch (error) {
      insights?.trackException({
        exception: error,
        properties: {
          name: 'web.static_blob_cache.fallback.initialize.error',
          account: config.client.fallback.blob.account,
          container: config.client.fallback.blob.container,
        },
      });
    }
  }
  return p.staticBlobCacheFallback;
}

export default class StaticBlobCacheFallback {
  private _options: IBlobCacheOptions;
  private _client: BlobServiceClient;
  private _container: ContainerClient;
  private _initialized: boolean;

  constructor(options: IBlobCacheOptions) {
    this._options = options;
  }

  async initialize() {
    if (this._initialized) {
      return;
    }
    const { account, key, tokenCredential } = this._options;
    if (!account) {
      throw new Error('options.account required');
    }
    if (!this._options.container) {
      throw new Error('options.container required');
    }
    if (!key && !tokenCredential) {
      throw CreateError.InvalidParameters('options.key or options.tokenCredential required');
    }
    const credential = key ? new StorageSharedKeyCredential(account, key) : tokenCredential;
    this._client = new BlobServiceClient(`https://${account}.blob.core.windows.net`, credential);
    try {
      this._container = this._client.getContainerClient(this._options.container);
      if (!(await this._container.exists())) {
        await this._client.createContainer(this._options.container);
      }
    } catch (containerError) {
      console.dir(containerError);
    }
    this._initialized = true;
  }

  async get(filename: string): Promise<[Buffer, string]> {
    this.throwIfNotInitialized();
    filename = filename.substr(1);
    if (this._options.folder) {
      filename = `${this._options.folder}/${filename}`;
    }
    debug(`BLOB FALLBACK GET: ${filename}`);
    const blobClient = this._container.getBlobClient(filename);
    try {
      const { contentType } = await blobClient.getProperties();
      const buffer = await blobClient.downloadToBuffer();
      return [buffer, contentType];
    } catch (error) {
      if (error && error.statusCode && error.statusCode === 404) {
        return [null, null];
      }
      console.dir(error);
      throw error;
    }
  }

  private throwIfNotInitialized() {
    if (!this._initialized) {
      throw new Error('Static blob cache provider must be initialized before it can be used');
    }
  }
}
