//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { CosmosClient, Database, Container } from '@azure/cosmos';
import Debug from 'debug';

import { CreateError } from './transitional.js';
import { getOrCreateCosmosClient } from '../middleware/cosmos.js';
import type { IProviders } from '../interfaces/providers.js';

const debug = Debug.debug('cosmosdb');

export type CosmosHelperOptions = {
  endpoint: string;
  database?: string;

  collection?: string;
  createCollectionIfNotExist?: boolean;

  key?: string;
  useManagedIdentity: boolean;
  tenantId?: string;
};

type AlmostAnything = string | number | boolean;

export interface ISimplifiedCosmosHelper {
  initialize(): Promise<void>;
  delete(partitionKey: string, documentId: string): Promise<void>;
  getObject<T>(partitionKey: string, documentId: string): Promise<T>;
  setObject<T extends Record<string, AlmostAnything>>(object: T): Promise<void>;
}

export class SimplifiedCosmosHelper implements ISimplifiedCosmosHelper {
  private _client: CosmosClient;
  private _initialized: boolean;
  private _database: Database;
  private _collection: Container;

  constructor(
    private providers: IProviders,
    private options: CosmosHelperOptions
  ) {}

  async initialize() {
    if (this._initialized) {
      return;
    }
    const { createCollectionIfNotExist, endpoint, key, useManagedIdentity } = this.options;
    if (!endpoint) {
      throw CreateError.InvalidParameters('options.endpoint required');
    }
    if (!useManagedIdentity && !key) {
      throw CreateError.InvalidParameters('options.key required');
    }
    if (!this.options.collection) {
      throw CreateError.InvalidParameters('options.collection required');
    }
    if (!this.options.database) {
      throw CreateError.InvalidParameters('options.database required');
    }
    this._client = await getOrCreateCosmosClient(this.providers, this.options);
    if (createCollectionIfNotExist) {
      this._database = (
        await this._client.databases.createIfNotExists({ id: this.options.database })
      ).database;
      this._collection = (
        await this._database.containers.createIfNotExists({ id: this.options.collection })
      ).container;
    } else {
      this._database = this._client.database(this.options.database);
      this._collection = this._database.container(this.options.collection);
    }
    this._initialized = true;
  }

  async getObject(partitionKey: string, documentId: string): Promise<any> {
    this.throwIfNotInitialized();
    debug(`COSMOS GET OBJECT: ${documentId} from PARTITION: ${partitionKey}`);
    const response = await this._collection.item(documentId, partitionKey).read();
    if (response.resource) {
      const clone = Object.assign({}, response.resource);
      delete clone._attachments;
      delete clone._etag;
      delete clone._rid;
      delete clone._self;
      delete clone._ts;
      delete clone.ttl;
      return clone;
    }
  }

  async setObject(object: any): Promise<void> {
    this.throwIfNotInitialized();
    debug(`COSMOS SET OBJECT: ${object.id}`);
    const approxSize = 0;
    try {
      const item = Object.assign({}, object);
      await this._collection.items.upsert(item);
    } catch (upsertError) {
      console.dir(upsertError);
      console.log(approxSize);
      throw upsertError;
    }
  }

  async delete(partitionKey: string, documentId: string): Promise<void> {
    await this._collection.item(documentId, partitionKey).delete();
  }

  private throwIfNotInitialized() {
    if (!this._initialized) {
      throw new Error('Cosmos provider must be initialized before it can be used');
    }
  }
}
