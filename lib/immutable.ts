//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { randomUUID } from 'crypto';

import type { IProviders, SiteConfiguration } from '../interfaces/index.js';

import BlobCache from './caching/blob.js';
import { getEntraApplicationUserAssignedIdentityCredential } from './applicationIdentity.js';
import { CreateError } from './transitional.js';
import getCompanySpecificDeployment from '../middleware/companySpecificDeployment.js';

export interface IImmutableStorageProvider {
  initialize(): Promise<void>;

  save(prefix: string, postfix: string, value: string): Promise<void>;
  saveObject(prefix: string, postfix: string, value: unknown): Promise<void>;

  saveInBackground(prefix: string, postfix: string, value: string): void;
  saveObjectInBackground(prefix: string, postfix: string, value: unknown): void;
}

export interface IImmutableStorageProviderRetrieval extends IImmutableStorageProvider {
  getPrefixContents(prefix: string): Promise<string[]>;
  getObject(blobName: string): Promise<unknown>;
}

export function tryGetImmutableStorageProvider(
  providers: IProviders,
  config: SiteConfiguration
): IImmutableStorageProvider {
  const companySpecific = getCompanySpecificDeployment();
  if (companySpecific?.features?.immutableProvider?.tryCreateInstance) {
    const provider = companySpecific.features.immutableProvider.tryCreateInstance(providers, config);
    if (provider) {
      return provider;
    }
  }
  const { immutable } = config;
  if (immutable.enabled) {
    const azure = immutable.azure;
    if (azure?.blob?.enabled) {
      return new AzureImmutableStorageProvider(config);
    }
  }
}

class AzureImmutableStorageProvider implements IImmutableStorageProvider, IImmutableStorageProviderRetrieval {
  constructor(private config: SiteConfiguration) {
    const immutableSegment = config.immutable.azure.blob;
    if (!immutableSegment.account || !immutableSegment.container) {
      throw CreateError.InvalidParameters(
        'Azure Blob Storage configuration is missing required values for the immutable storage provider'
      );
    }
  }

  private _blob: BlobCache;

  async initialize(): Promise<void> {
    const credential = getEntraApplicationUserAssignedIdentityCredential(this.config);
    const immutableSegment = this.config.immutable.azure.blob;
    const blobCache = new BlobCache({
      account: immutableSegment.account,
      container: immutableSegment.container,
      tokenCredential: credential,
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

  async getPrefixContents(prefix: string): Promise<string[]> {
    const cacheAsSpecificType = this._blob as BlobCache;
    const containerClient = cacheAsSpecificType.getContainerClient();
    const blobs: string[] = [];
    for await (const blob of containerClient.listBlobsFlat({ prefix })) {
      blobs.push(blob.name);
    }
    return blobs;
  }

  async getObject(blobName: string): Promise<unknown> {
    const cacheAsSpecificType = this._blob as BlobCache;
    const blobServiceClient = cacheAsSpecificType.getContainerClient();
    const buffer = await blobServiceClient.getBlobClient(blobName).downloadToBuffer();
    const asString = buffer.toString('utf8');
    return JSON.parse(asString);
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
