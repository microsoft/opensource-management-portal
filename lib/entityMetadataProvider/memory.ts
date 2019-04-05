//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

import { IEntityMetadataProvider, IEntityMetadataFixedQuery } from './entityMetadataProvider';
import { IEntityMetadata, EntityMetadataType } from './entityMetadata';

module.exports = function createProvider(providers, config) {
  const memoryOptions = {};
  return new MemoryEntityMetadataProvider(providers, memoryOptions);
};

export class MemoryEntityMetadataProvider implements IEntityMetadataProvider {
  private _entitiesByType: Map<EntityMetadataType, Map<string, IEntityMetadata[]>>;
  public readonly supportsHistory: boolean = true;

  constructor(providers: any, options: any) {
  }

  async initialize(): Promise<void> {
    this._entitiesByType = new Map();
  }

  private entityBin(type: EntityMetadataType): Map<string, IEntityMetadata[]> {
    let map: Map<string, IEntityMetadata[]> = this._entitiesByType.get(type);
    if (!map) {
      map = new Map<string, IEntityMetadata[]>();
      this._entitiesByType.set(type, map);
    }
    return map;
  }

  async getMetadata(type: EntityMetadataType, id: string): Promise<IEntityMetadata> {
    const bin = this.entityBin(type).get(id);
    return bin ? bin[bin.length - 1] : null;
  }

  async setMetadata(metadata: IEntityMetadata): Promise<void> {
    const type = metadata.entityType;
    const id = metadata.entityId;
    let bin = this.entityBin(type).get(id);
    if (!bin) {
      bin = [];
      this.entityBin(type).set(id, bin);
    }
    bin.push(metadata);
  }

  async getMetadataHistory(type: EntityMetadataType, id: string): Promise<IEntityMetadata[]> {
    const bin = this.entityBin(type).get(id) || [];
    const history = bin.slice().reverse();
    return history;
  }

  fixedQueryMetadata(type: EntityMetadataType, query: IEntityMetadataFixedQuery): Promise<IEntityMetadata[]> {
    throw new Error("Method not implemented.");
  }
}
