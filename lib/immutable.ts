//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { randomUUID } from 'crypto';

import type { ConfigImmutableAzureBlobStorage } from '../config/immutable.types';
import type { SiteConfiguration } from '../interfaces';
import BlobCache from './caching/blob';

export interface IImmutableStorageProvider {
  initialize(): Promise<void>;

  save(prefix: string, postfix: string, value: string): Promise<void>;
  saveObject(prefix: string, postfix: string, value: unknown): Promise<void>;

  saveInBackground(prefix: string, postfix: string, value: string): void;
  saveObjectInBackground(prefix: string, postfix: string, value: unknown): void;
}

export function tryGetImmutableStorageProvider(config: SiteConfiguration): IImmutableStorageProvider {
  const { immutable } = config;
  if (immutable.enabled) {
    const azure = immutable.azure;
    if (azure?.blob?.enabled) {
      return new AzureImmutableStorageProvider(azure.blob);
    }
  }
}

class AzureImmutableStorageProvider implements IImmutableStorageProvider {
  constructor(config: ConfigImmutableAzureBlobStorage) {
    if (!config.account || !config.key || !config.container) {
      throw new Error(
        'Azure Blob Storage configuration is missing required values for the immutable storage provider'
      );
    }
    this.config = config;
  }

  private config: ConfigImmutableAzureBlobStorage;
  private _blob: BlobCache;

  async initialize(): Promise<void> {
    const blobCache = new BlobCache({
      account: this.config.account,
      key: this.config.key,
      container: this.config.container,
    });
    await blobCache.initialize();
    this._blob = blobCache;
  }

  private timeKey(prefix: string, postfix: string) {
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth() + 1;
    const day = now.getUTCDate();
    const filename = `${postfix ? postfix + '/' : ''}${randomUUID()}`;
    const candidate = `${prefix ? prefix + '/' : ''}${year}/${month}/${day}/${filename}`;
    return candidate.replace(/\/\//g, '/');
  }

  async save(prefix: string, postfix: string, value: string): Promise<void> {
    return this._blob.set(this.timeKey(prefix, postfix), value);
  }

  async saveObject(prefix: string, postfix: string, value: unknown): Promise<void> {
    return this._blob.setObject(this.timeKey(prefix, postfix), value);
  }

  saveInBackground(prefix: string, postfix: string, value: string): void {
    this.save(prefix, postfix, value).catch((error) => {
      console.warn(
        `Error saving immutable string to Azure Blob Storage: ${error}, prefix=${prefix}, postfix=${postfix}`
      );
    });
  }

  saveObjectInBackground(prefix: string, postfix: string, value: unknown): void {
    this.saveObject(prefix, postfix, value).catch((error) => {
      console.warn(
        `Error saving immutable object to Azure Blob Storage: ${error}, prefix=${prefix}, postfix=${postfix}`
      );
    });
  }
}
