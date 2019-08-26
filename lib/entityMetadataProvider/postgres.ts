//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

// Note: numbers are cast to strings

import { Pool as PostgresPool } from 'pg';

import {
  IEntityMetadataProvider,
  IEntityMetadataSerializationHelper,
  IEntityMetadataDeserializationHelper,
  SerializeObjectToEntityMetadata,
  DeserializeEntityMetadataToObjectSetCollection } from './entityMetadataProvider';
import { IEntityMetadata, EntityMetadataType, EntityMetadataTypes } from './entityMetadata';
import { PostgresPoolQuerySingleRowAsync, PostgresPoolQueryAsync } from '../postgresHelpers';
import { IEntityMetadataFixedQuery } from './query';
import { EntityMetadataMappings, MetadataMappingDefinition } from './declarations';

interface IPostgresGetQueries {
  (query: IEntityMetadataFixedQuery, mapMetadataPropertiesToFields: string[], metadataColumnName: string, tableName: string, getEntityTypeColumnValue: any): any;
}

const MapMetadataPropertiesToFields: any = {
  entityCreated: null,
  entityFieldNames: null,
  entityId: 'entityid',
  entityType: 'entitytype',
};

const MetadataColumnName = 'metadata';

export interface IPostgresEntityMetadataProviderOptions {
  entityTypeToTableNamesMapping?: any;
  entityTypeToColumnValuesMapping?: any;
  pool: PostgresPool;
}

export class PostgresEntityMetadataProvider implements IEntityMetadataProvider {
  public readonly supportsHistory: boolean = false;
  public readonly name = 'postgres';

  private _pool: PostgresPool;
  private _entityTypeToTableNamesMapping: any;
  private _entityTypeToColumnValuesMapping: any;

  constructor(options: IPostgresEntityMetadataProviderOptions) {
    if (!options) {
      throw new Error('IPostgresEntityMetadataProviderOptions required');
    }

    this._pool = options.pool;
    if (!this._pool) {
      throw new Error('PostgresEntityMetadataProvider requires a Postgres pool')
    }
    this._entityTypeToTableNamesMapping = Object.assign(defaultTableNames(), (options.entityTypeToTableNamesMapping || {}));
    this._entityTypeToColumnValuesMapping = Object.assign(defaultTypeColumnNames(), (options.entityTypeToColumnValuesMapping || {}));
  }

  async initialize(): Promise<void> {}

  supportsPointQueryForType(type: EntityMetadataType): boolean {
    return true;
  }

  async getMetadata(type: EntityMetadataType, id: string): Promise<IEntityMetadata> {
    const tableName = this.getTableName(type);
    const row = await PostgresPoolQuerySingleRowAsync(this._pool, `
      SELECT *
      FROM ${tableName}
      WHERE
        entitytype = $1 AND
        entityid = $2
    `, [
      this.getEntityTypeColumnValue(type),
      id,
    ]);
    return this.rowToMetadataObject(type, row);
  }

  async setMetadata(metadata: IEntityMetadata): Promise<void> {
    const tableName = this.getTableName(metadata.entityType);
    const jsonValue = this.metadataToRowMetadata(metadata);
    try {
      const result = await PostgresPoolQueryAsync(this._pool, `
        INSERT INTO ${tableName}(
          ${MapMetadataPropertiesToFields['entityType']},
          ${MapMetadataPropertiesToFields['entityId']},
          ${MetadataColumnName}
        )
        VALUES (
            $1, $2, $3
        )
      `, [
        this.getEntityTypeColumnValue(metadata.entityType),
        metadata.entityId,
        jsonValue,
      ]);
    } catch (insertError) {
      // insertError: message includes "duplicate key value violates"
      throw insertError;
    }
  }

  async updateMetadata(metadata: IEntityMetadata): Promise<void> {
    const tableName = this.getTableName(metadata.entityType);
    const jsonValue = this.metadataToRowMetadata(metadata); // TEMP, move into query after
    await PostgresPoolQueryAsync(this._pool, `
      UPDATE ${tableName}
      SET ${MetadataColumnName} = $1
      WHERE
        ${MapMetadataPropertiesToFields['entityType']} = $2 AND
        ${MapMetadataPropertiesToFields['entityId']} = $3
    `, [
      jsonValue,
      this.getEntityTypeColumnValue(metadata.entityType),
      metadata.entityId,
    ]);
  }

  async deleteMetadata(metadata: IEntityMetadata): Promise<void> {
    const tableName = this.getTableName(metadata.entityType);
    await PostgresPoolQueryAsync(this._pool, `
      DELETE FROM ${tableName}
      WHERE
        ${MapMetadataPropertiesToFields['entityType']} = $1 AND
        ${MapMetadataPropertiesToFields['entityId']} = $2
    `, [
      this.getEntityTypeColumnValue(metadata.entityType),
      metadata.entityId,
    ]);
  }

  async clearMetadataStore(type: EntityMetadataType): Promise<void> {
    const tableName = this.getTableName(type);
    await PostgresPoolQueryAsync(this._pool, `
      DELETE FROM ${tableName}
      WHERE
        ${MapMetadataPropertiesToFields['entityType']} = $1
    `, [
      this.getEntityTypeColumnValue(type),
    ]);
  }

  async getMetadataHistory(type: EntityMetadataType, id: string): Promise<IEntityMetadata[]> {
    throw new Error('History not supported by the Postgres metadata provider');
  }

  async fixedQueryMetadata(type: EntityMetadataType, query: IEntityMetadataFixedQuery): Promise<IEntityMetadata[]> {
    const tableName = this.getTableName(type);
    const { sql, values } = this.createQueryFromFixedQueryEnum(tableName, type, query);
    return await this.sqlQueryToMetadataArray(type, sql, values);
  }

  getSerializationHelper(type: EntityMetadataType): IEntityMetadataSerializationHelper {
    const mapObjectToPostgresFields = EntityMetadataMappings.GetDefinition(type, MetadataMappingDefinition.PostgresMapping, true);
    if (!mapObjectToPostgresFields) {
      return null;
    }
    const idFieldName = EntityMetadataMappings.GetDefinition(type, MetadataMappingDefinition.EntityIdColumnName, true);
    return function objectToPostgresEntity(obj: any): IEntityMetadata {
      const metadata = SerializeObjectToEntityMetadata(type, idFieldName, obj, mapObjectToPostgresFields, true /* numbers to strings */, true /* throw if missing translations */, true);
      return metadata;
    };
  }

  getDeserializationHelper(type: EntityMetadataType): IEntityMetadataDeserializationHelper {
    const mapObjectToPostgresFields = EntityMetadataMappings.GetDefinition(type, MetadataMappingDefinition.PostgresMapping, true);
    if (!mapObjectToPostgresFields) {
      return null;
    }
    const idFieldName = EntityMetadataMappings.GetDefinition(type, MetadataMappingDefinition.EntityIdColumnName, true);
    return function postgresEntityToObject(entity: IEntityMetadata): any {
      const approval = EntityMetadataMappings.InstantiateObject(type);
      const toSet = DeserializeEntityMetadataToObjectSetCollection(entity, idFieldName, mapObjectToPostgresFields);
      for (const property in toSet) {
        approval[property] = toSet[property];
      }
      return approval;
    };
  }

  private getEntityTypeColumnValue(type: EntityMetadataType): string {
    const value = this._entityTypeToColumnValuesMapping[type];
    if (!value) {
      throw new Error(`No Postgres column value mapping provider for EntityMetadataType value ${type}`);
    }
    return value;
  }

  private getTableName(type: EntityMetadataType): string {
    // CONSIDER: for safety, should the table name be forced safe here?
    const tableName = this._entityTypeToTableNamesMapping[type];
    if (tableName) {
      return tableName;
    }
    if (!tableName) {
      // NOTE if you see an error here: are you sure that the entity metadata list includes your type?
      throw new Error(`No Postgres table name mapping provided for EntityMetadataType value ${type}`);
    }
  }

  private metadataToRowMetadata(metadata: IEntityMetadata): any {
    const shallowClone = Object.assign({}, metadata);
    delete shallowClone.entityCreated;
    delete shallowClone.entityFieldNames;
    delete shallowClone.entityId;
    delete shallowClone.entityType;
    return shallowClone;
  }

  private stripEntityIdentities(entity: any) {
    let entityTypeString = null;
    let entityCreated = null;
    let entityId = null;
    if (MapMetadataPropertiesToFields.entityType) {
      entityTypeString = entity[MapMetadataPropertiesToFields.entityType];
      delete entity[MapMetadataPropertiesToFields.entityType];
    }
    if (MapMetadataPropertiesToFields.entityId) {
      entityId = entity[MapMetadataPropertiesToFields.entityId];
      delete entity[MapMetadataPropertiesToFields.entityId];
    }
    if (MapMetadataPropertiesToFields.entityCreated) {
      entityCreated = entity[MapMetadataPropertiesToFields.entityCreated];
      delete entity[MapMetadataPropertiesToFields.entityCreated];
    }
    const metadata = entity[MetadataColumnName];
    const entityFieldNames = Object.getOwnPropertyNames(metadata);
    const remainingObjectProperties = Object.getOwnPropertyNames(entity).filter(name => { name !== MetadataColumnName });
    return { entity: metadata, entityTypeString, entityId, entityCreated, entityFieldNames, remainingObjectProperties };
  }

  private rowToMetadataObject(type: EntityMetadataType, row: any): IEntityMetadata {
    const { entity, entityTypeString, entityId, entityCreated, entityFieldNames } = this.stripEntityIdentities(row);
    const entityIdentity: IEntityMetadata = {
      entityType: type,
      entityId,
      entityFieldNames,
      entityCreated,
    };
    const newMetadataObject: IEntityMetadata = Object.assign(entity, entityIdentity);
    return newMetadataObject;
  }

  private async sqlQueryToMetadataArray(type, sql, values): Promise<IEntityMetadata[]> {
    const result = await PostgresPoolQueryAsync(this._pool, sql, values);
    const rows = result['rows'];
    if (!rows) {
      throw new Error('No rows or empty rows returned');
    }
    return rows.map(row => {
      return this.rowToMetadataObject(type, row);
    });
  }

  private createQueryFromFixedQueryEnum(tableName: string, type: EntityMetadataType, query: IEntityMetadataFixedQuery): any {
    let get = EntityMetadataMappings.GetDefinition(type, MetadataMappingDefinition.PostgresQueries, true) as IPostgresGetQueries;
    const self = this;
    const getEntityTypeColumnValue = function(t) {
      return self.getEntityTypeColumnValue(t);
    }
    return get(query, MapMetadataPropertiesToFields, MetadataColumnName, tableName, getEntityTypeColumnValue);
  }
}

function defaultTableNames() {
  const defaults = {};
  EntityMetadataTypes.forEach(type => {
    try {
      if(!EntityMetadataMappings.GetDefinition(type, MetadataMappingDefinition.PostgresMapping, false)) {
        return;
      }
      const tableName = EntityMetadataMappings.GetDefinition(type, MetadataMappingDefinition.PostgresDefaultTableName, true);
      defaults[type] = tableName;
    } catch (noDefaultTableNameError) {
      throw new Error(`No default Postgres table name is defined for the type ${type}`);
    }
  });
  return defaults;
}

function defaultTypeColumnNames() {
  const defaults = {};
  EntityMetadataTypes.forEach(type => {
    try {
      if(!EntityMetadataMappings.GetDefinition(type, MetadataMappingDefinition.PostgresMapping, false)) {
        return;
      }
      const column = EntityMetadataMappings.GetDefinition(type, MetadataMappingDefinition.PostgresDefaultTypeColumnName, true);
      defaults[type] = column;
    } catch (noDefaultTableNameError) {
      throw new Error(`No default Postgres type column name is defined for the type ${type}`);
    }
  });
  return defaults;
}
