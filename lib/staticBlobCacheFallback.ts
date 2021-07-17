//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { DefaultAzureCredential } from '@azure/identity';
import {
  BlobServiceClient,
  StorageSharedKeyCredential,
  ContainerClient,
} from '@azure/storage-blob';

import { IProviders } from '../interfaces';

const debug = require('debug')('cache');

export interface IBlobCacheOptions {
  account: string;
  key: string;
  container: string;
}

interface IExtendedProviders extends IProviders {
  staticBlobCacheFallback: StaticBlobCacheFallback;
}

export async function getStaticBlobCacheFallback(providers: IProviders) {
  const p = providers as IExtendedProviders;
  if (!p.staticBlobCacheFallback) {
    p.staticBlobCacheFallback = new StaticBlobCacheFallback(providers.config?.client?.fallback?.blob);
    await p.staticBlobCacheFallback.initialize();
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
    const { account, key } = this._options;
    if (!account) {
      throw new Error('options.account required');
    }
    if (!this._options.container) {
      throw new Error('options.container required');
    }
    if (!key) {
      // TODO: remove after validation
      console.log('Temporary note: using DefaultAzureCredential without a key');
    }
    const credential = key ? new StorageSharedKeyCredential(account, key) : new DefaultAzureCredential();
    this._client = new BlobServiceClient(
      `https://${account}.blob.core.windows.net`,
      credential,
    );
    try {
      this._container = this._client.getContainerClient(this._options.container);
      if (!await this._container.exists()) {
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
      throw new Error('This provider must be initialized before it can be used');
    }
  }
}
