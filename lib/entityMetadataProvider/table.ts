//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

// Azure table storage implementation on top of the generic metadata provider
// interface. The metadata type maps to a table name.

// Opinions of note: any entities passed for storage that have a _number_ will
// be stored in Azure table as a _string_.

// Partitioning: none. For historical reasons around scale, only a fixed pkey
// is used for this product.

import {
  AzureNamedKeyCredential,
  Edm,
  NamedKeyCredential,
  TableClient,
  TableEntityQueryOptions,
  TableEntityResult,
  TableEntityResultPage,
  TableServiceClient,
} from '@azure/data-tables';

import { randomUUID } from 'crypto';

const debugShowTableOperations = false;

const emptyString = '';

type AzureDataTablesQueryResponse = TableEntityResultPage<Record<string, unknown>>;

//type AzureDataTablesQueryResponse = ListEntitiesResponse<object>; // or ? ListEntitiesResponse<TableEntityResult<object>>;

import {
  IEntityMetadataProvider,
  IEntityMetadataSerializationHelper,
  IEntityMetadataDeserializationHelper,
  SerializeObjectToEntityMetadata,
  DeserializeEntityMetadataToObjectSetCollection,
  IObjectWithDefinedKeys,
  EntityFieldNames,
} from './entityMetadataProvider';
import { IEntityMetadata, EntityMetadataType, EntityMetadataTypes } from './entityMetadata';
import { IEntityMetadataFixedQuery } from './query';
import {
  MetadataMappingDefinition,
  EntityMetadataMappings,
  MetadataMappingDefinitionBase,
} from './declarations';
import { encryptTableEntity, decryptTableEntity, ITableEncryptionOperationOptions } from './tableEncryption';
import { CreateError, ErrorHelper } from '../transitional';
import { IKeyVaultSecretResolver } from '../keyVaultResolver';

export interface ITableEncryptionOptions {
  keyEncryptionKeyId: string;
  keyResolver: IKeyVaultSecretResolver;
}

export interface ITableEntityMetadataProviderOptions {
  metadataTypeToTableNameMapping?: any;
  metadataTypeToFixedPartitionKeyMapping?: any;
  metadataTypeToRowKeyPrefixMapping?: any;
  metadataTypeToEncryptedColumnsMapping?: any;
  account: string;
  key: string;
  prefix?: string;
  encryption?: ITableEncryptionOptions;
}

class TableMetadataDefinition extends MetadataMappingDefinitionBase {
  constructor(name: string) {
    super(name);
  }
}

export const TableSettings = {
  TableMapping: new TableMetadataDefinition('TableMapping'),
  TablePossibleDateColumns: new TableMetadataDefinition('TablePossibleDateColumns'),
  TableQueries: new TableMetadataDefinition('TableQueries'),
  TableNoPointQueries: new TableMetadataDefinition('TableNoPointQueries'),
  TableNoPointQueryMapping: new TableMetadataDefinition('TableNoPointQueryMapping'),
  TableNoPointQueryAlternateIdFieldName: new TableMetadataDefinition('TableNoPointQueryAlternateIdFieldName'),
  TableSpecializedDeserializationHelper: new TableMetadataDefinition('TableSpecializedDeserializationHelper'),
  TableSpecializedSerializationHelper: new TableMetadataDefinition('TableSpecializedSerializationHelper'),
  TableDefaultTableName: new TableMetadataDefinition('TableDefaultTableName'),
  TableDefaultFixedPartitionKey: new TableMetadataDefinition('TableDefaultFixedPartitionKey'),
  TableDefaultFixedPartitionKeyNoPrefix: new TableMetadataDefinition('TableDefaultFixedPartitionKeyNoPrefix'),
  TableDefaultRowKeyPrefix: new TableMetadataDefinition('TableDefaultRowKeyPrefix'),
  TableEncryptedColumnNames: new TableMetadataDefinition('TableEncryptedColumnNames'),
};

const TableClientProperties = new Set([
  'timestamp',
  'partitionKey',
  'rowKey',
  // former client: '.metadata',
  'odata.metadata',
  'etag',
]);

interface ITableEntity {
  rowKey: string;
  partitionKey: string;
}

export class TableEntityMetadataProvider implements IEntityMetadataProvider {
  public readonly supportsHistory: boolean = false;
  public readonly name = 'table';

  private _storageAccountName: string;

  private _azureTableServiceClient: TableServiceClient;
  private _azureTables: Map<string, TableClient> = new Map();
  private _azureTablesCredential: NamedKeyCredential;

  private _tableNameMapping: any;
  private _fixedPartitionKeyMapping: any;
  private _rowKeyPrefixMapping: any;
  private _typeToEncryptedColumnsMapping: any;
  private _typeToEncryptionOptions: Map<EntityMetadataType, ITableEncryptionOperationOptions>;

  private _encryptionOptions: ITableEncryptionOptions;

  private _prefix: string;

  private _initialized: boolean;
  private _initializedTables: Map<EntityMetadataType, string>;

  constructor(options: ITableEntityMetadataProviderOptions) {
    if (!options) {
      throw new Error('ITableEntityMetadataProviderOptions required');
    }
    this._tableNameMapping = Object.assign(defaultTableNames(), options.metadataTypeToTableNameMapping || {});

    this._storageAccountName = options.account;
    if (!this._storageAccountName) {
      throw new Error('Storage account name required');
    }
    const storageAccountKey = options.key;
    if (!storageAccountKey) {
      throw new Error('Storage account key required');
    }
    this._prefix = options.prefix || '';
    this._fixedPartitionKeyMapping = Object.assign(
      defaultFixedPartitionKeys(this._prefix),
      options.metadataTypeToFixedPartitionKeyMapping || {}
    );
    this._rowKeyPrefixMapping = Object.assign(
      defaultRowKeyPrefixes(),
      options.metadataTypeToRowKeyPrefixMapping || {}
    );
    this._typeToEncryptedColumnsMapping = Object.assign(
      defaultEncryptionColumns(),
      options.metadataTypeToEncryptedColumnsMapping || {}
    );
    this._typeToEncryptionOptions = new Map();
    this._encryptionOptions = options.encryption;
    try {
      this._azureTablesCredential = new AzureNamedKeyCredential(this._storageAccountName, storageAccountKey);
      this._azureTableServiceClient = new TableServiceClient(
        `https://${this._storageAccountName}.table.core.windows.net`,
        this._azureTablesCredential
      );
    } catch (storageAccountError) {
      throw storageAccountError;
    }
    this._initializedTables = new Map();
  }

  private getTableClient(tableName: string) {
    let client = this._azureTables.get(tableName);
    if (!client) {
      client = new TableClient(
        `https://${this._storageAccountName}.table.core.windows.net`,
        tableName,
        this._azureTablesCredential
      );
      this._azureTables.set(tableName, client);
    }
    return client;
  }

  supportsPointQueryForType(type: EntityMetadataType): boolean {
    const noPointQueries = EntityMetadataMappings.GetDefinition(
      type,
      TableSettings.TableNoPointQueries,
      false
    );
    if (noPointQueries) {
      // The original implementation of storing repository create
      // metadata in table stored the data in a new row without any
      // ID. Then, a few years later, 'repoId' was set to the new
      // repo ID, which is more durable than repository names which
      // can change. By not supporting point queries for the repository
      // type, a query is used for get operations instead. Which... is slow.
      return false;
    }
    return true;
  }

  async initialize(): Promise<void> {
    this._initialized = true;
  }

  // ---

  async getMetadata(type: EntityMetadataType, id: string): Promise<IEntityMetadata> {
    this.throwIfNotInitialized();
    const tableName = await this.initializeEntityType(type);
    const tableEntity = await this.tableRetrieveEntity(
      type,
      tableName,
      this.getFixedPartitionKey(type),
      this.getRowKey(type, id)
    );
    return this.tableEntityToMetadataObject(type, tableEntity);
  }

  async setMetadata(metadata: IEntityMetadata): Promise<void> {
    this.throwIfNotInitialized();
    const tableName = await this.initializeEntityType(metadata.entityType);
    const tableEntity = this.metadataToTableEntity(metadata);
    const result = await this.tableInsertEntity(metadata.entityType, tableName, tableEntity);
  }

  async updateMetadata(metadata: IEntityMetadata): Promise<void> {
    this.throwIfNotInitialized();
    const tableName = await this.initializeEntityType(metadata.entityType);
    const tableEntity = this.metadataToTableEntity(metadata);
    const result = await this.tableReplaceEntity(metadata.entityType, tableName, tableEntity);
  }

  async deleteMetadata(metadata: IEntityMetadata): Promise<void> {
    this.throwIfNotInitialized();
    const tableName = await this.initializeEntityType(metadata.entityType);
    await this.tableDeleteEntity(
      tableName,
      this.getFixedPartitionKey(metadata.entityType),
      this.getRowKey(metadata.entityType, metadata.entityId)
    );
  }

  async clearMetadataStore(type: EntityMetadataType): Promise<void> {
    throw new Error('The table provider does not support clearMetadataStore');
  }

  async fixedQueryMetadata(
    type: EntityMetadataType,
    query: IEntityMetadataFixedQuery
  ): Promise<IEntityMetadata[]> {
    this.throwIfNotInitialized();
    const tableName = await this.initializeEntityType(type);
    const azureTableQuery = this.createQueryFromFixedQueryEnum(type, query);
    return await this.tableQueryToMetadataArray(type, tableName, azureTableQuery);
  }

  // ---

  private throwIfNotInitialized() {
    if (!this._initialized) {
      throw new Error('TableEntityMetadataProvider is not initialized');
    }
  }

  private getFixedPartitionKey(type: EntityMetadataType) {
    const pk = this._fixedPartitionKeyMapping[type.typeName];
    if (pk) {
      return pk;
    }
    throw new Error(`No fixed partition key is defined for the type: ${type}`);
  }

  private isTypeEncrypted(type: EntityMetadataType): Set<string> {
    if (!this._encryptionOptions) {
      return null;
    }
    const set = this._typeToEncryptedColumnsMapping[type.typeName] as Set<string>;
    return set && set.size > 0 ? set : null;
  }

  private getEncryptionOptionsForType(type: EntityMetadataType): ITableEncryptionOperationOptions {
    let options = this._typeToEncryptionOptions.get(type);
    if (options) {
      return options;
    }
    if (!this._encryptionOptions) {
      throw new Error('Encryption options required');
    }
    if (!this._encryptionOptions.keyEncryptionKeyId) {
      throw new Error('keyEncryptionKeyId encryption option required');
    }
    if (!this._encryptionOptions.keyResolver) {
      throw new Error('keyResolver encryption option required');
    }
    options = {
      keyEncryptionKeyId: this._encryptionOptions.keyEncryptionKeyId,
      keyResolver: this._encryptionOptions.keyResolver,
      encryptedPropertyNames: this.isTypeEncrypted(type),
      binaryProperties: 'buffer',
    };
    this._typeToEncryptionOptions.set(type, options);
    return options;
  }

  private getRowKey(type: EntityMetadataType, entityId: string) {
    const prefix = this._rowKeyPrefixMapping[type.typeName] || emptyString;
    return `${prefix}${entityId}`;
  }

  private rowKeyToEntityId(type: EntityMetadataType, rowKey: string) {
    const prefix = this._rowKeyPrefixMapping[type.typeName] || emptyString;
    if (!prefix) {
      return rowKey;
    }
    if (rowKey.startsWith(prefix)) {
      return rowKey.substr(prefix.length);
    }
    throw new Error(
      `The entity type ${type} table provider has a defined and expected prefix of ${prefix} that was not present for the entity at row key ${rowKey}`
    );
  }

  private async initializeEntityType(type: EntityMetadataType): Promise<string> {
    let tableName = this._initializedTables.get(type);
    if (tableName) {
      return tableName;
    }
    const tableSuffix = this._tableNameMapping[type.typeName];
    if (!tableSuffix) {
      throw new Error(`No storage table name mapping provided for value ${type}`);
    }
    tableName = `${this._prefix}${tableSuffix}`;
    await this.tableCreateIfNotExists(type, tableName);
    return tableName;
  }

  private metadataToTableEntity(metadata: IEntityMetadata): ITableEntity {
    if (!metadata.entityId) {
      throw new Error(`metadata.entityId must be provided`);
    }
    const rowKey = this.getRowKey(metadata.entityType, metadata.entityId);
    const partitionKey = this.getFixedPartitionKey(metadata.entityType);
    const te: any = {};
    const fieldNames = metadata.entityFieldNames;
    if (!fieldNames || !Array.isArray(fieldNames)) {
      throw new Error('metadata.entityFieldNames is not an array');
    }
    for (let i = 0; i < fieldNames.length; i++) {
      const key = fieldNames[i];
      const value = this.createEntityDescriptorForValue(key, metadata[key]);
      if (value) {
        te[key] = value;
      }
    }
    const entity: ITableEntity = Object.assign(te, this.createRowEntity(partitionKey, rowKey));
    return entity;
  }

  private createEntityDescriptorForValue(key: string, value: any) {
    if (value === undefined || value === null) {
      // Table provider should not include null/undefined values
      return value;
    }
    if (typeof value === 'string') {
      return { type: 'String', value } as Edm<'String'>;
    } else if (value === true || value === false) {
      return { type: 'Boolean', value } as Edm<'Boolean'>;
    } else if (Buffer.isBuffer(value)) {
      const asBuffer = value as Buffer;
      const binaryValue = asBuffer.buffer;
      return { type: 'Binary', value: Buffer.from(binaryValue).toString('base64') } as Edm<'Binary'>;
    } else if (value instanceof Date) {
      if (!isFinite(value as any)) {
        return undefined;
      }
      return { type: 'DateTime', value: (value as Date).toISOString() } as Edm<'DateTime'>;
    } else if (typeof value === 'number') {
      // NOTE: OPINIONATED: we store all numbers are strings in Azure Table...
      const numberAsString = String(value as number);
      return { type: 'String', value: numberAsString } as Edm<'String'>;
    }
    throw new Error(`The key ${key} in the entity is of an unsupported type: ${typeof value}`);
  }

  private tableEntityToMetadataObject(
    type: EntityMetadataType,
    tableEntity: TableEntityResult<object>
  ): IEntityMetadata {
    const id = this.rowKeyToEntityId(type, tableEntity.rowKey);
    const created = tableEntity.timestamp;
    const reducedObject = this.reduceTableEntityToObject(tableEntity);
    const keys = Object.getOwnPropertyNames(reducedObject);
    const newMetadataObject: IEntityMetadata = Object.assign(reducedObject, {
      entityType: type,
      entityId: id,
      entityFieldNames: keys,
      entityCreated: created,
    });
    return newMetadataObject;
  }

  private reduceTableEntityToObject(tableEntity: any): any {
    if (tableEntity === undefined || tableEntity === null) {
      return tableEntity;
    }
    const newObject = {};
    for (const column in tableEntity) {
      if (TableClientProperties.has(column)) {
        // Timestamp, PartitionKey, RowKey, .metadata
        continue;
      }
      const value = tableEntity[column];
      newObject[column] = value?.type && value?.value ? value.value : value;
    }
    return newObject;
  }

  private createRowEntity(partitionKey: string, rowKey: string): ITableEntity {
    return {
      partitionKey,
      rowKey,
    };
  }

  private async tableQueryToMetadataArray(
    type: EntityMetadataType,
    tableName: string,
    azureTableQuery: TableEntityQueryOptions
  ): Promise<IEntityMetadata[]> {
    const tableEntities = await this.tableQueryAllEntities(type, tableName, azureTableQuery);
    const mapped = tableEntities.map((tableEntity) => {
      return this.tableEntityToMetadataObject(type, tableEntity);
    });
    return mapped;
  }

  private async tableQueryAllEntities(
    type: EntityMetadataType,
    tableName: string,
    azureTableQuery: TableEntityQueryOptions
  ): Promise<any[]> {
    const rows = [];
    let continuationToken: string = null;
    if (debugShowTableOperations) {
      displayTableQuery(
        'TABLE QUERY',
        this._storageAccountName,
        tableName,
        azureTableQuery,
        null,
        debugShowTableOperations
      );
    }
    do {
      const resultSet = await this.tableQueryEntities(type, tableName, azureTableQuery, continuationToken);
      if (resultSet.length > 0) {
        rows.push(...resultSet);
      }
      // NOTE: this could be much more efficient with the newer async-iterable data-tables implementation...
      continuationToken = getContinuationToken(resultSet);
    } while (continuationToken !== null);
    if (debugShowTableOperations) {
      console.log(`Total rows returned: ${rows.length}`);
    }
    return rows;
  }

  private async tableQueryEntities(
    type: EntityMetadataType,
    tableName: string,
    azureTableQuery: TableEntityQueryOptions,
    continuationToken?: string
  ): Promise<AzureDataTablesQueryResponse> {
    const results = await this.tableQueryEntitiesAsync(tableName, azureTableQuery, continuationToken);
    const encryptedColumnNames = this.isTypeEncrypted(type);
    if (encryptedColumnNames) {
      const encryptionOptions = this.getEncryptionOptionsForType(type);
      const decryptedEntries = await this.decryptQueryResults(type, encryptionOptions, results);
      results.length = 0;
      for (let i = 0; i < decryptedEntries.length; i++) {
        results.push(decryptedEntries[i]);
      }
    }
    return results;
  }

  private async decryptQueryResults(
    type: EntityMetadataType,
    encryptionOptions: ITableEncryptionOperationOptions,
    results: AzureDataTablesQueryResponse
  ): Promise<TableEntityResult<object>[]> {
    const decrypted: TableEntityResult<object>[] = [];
    // sync; throat may be a better call if encrypted queries are common
    for (let i = 0; i < results.length; i++) {
      const entity = results[i];
      const decryptedEntity = await decryptTableEntity(
        entity.partitionKey,
        entity.rowKey,
        entity,
        encryptionOptions
      );
      decrypted.push(decryptedEntity);
    }
    return decrypted;
  }

  private async tableReplaceEntity(
    type: EntityMetadataType,
    tableName: string,
    entity: ITableEntity
  ): Promise<any> {
    const encryptedColumnNames = this.isTypeEncrypted(type);
    if (encryptedColumnNames) {
      entity = await encryptTableEntity(
        entity.partitionKey,
        entity.rowKey,
        entity,
        this.getEncryptionOptionsForType(type)
      );
    }
    const result = await this.tableReplaceEntityAsync(tableName, entity);
    if (debugShowTableOperations) {
      displayTableRow(
        'TABLE REPLACE',
        this._storageAccountName,
        tableName,
        entity,
        result['.metadata'].etag,
        debugShowTableOperations
      );
    }
    return result;
  }

  private async tableInsertEntity(
    type: EntityMetadataType,
    tableName: string,
    entity: ITableEntity
  ): Promise<any> {
    const encryptedColumnNames = this.isTypeEncrypted(type);
    if (encryptedColumnNames) {
      entity = await encryptTableEntity(
        entity.partitionKey,
        entity.rowKey,
        entity,
        this.getEncryptionOptionsForType(type)
      );
    }
    let result = null;
    try {
      result = await this.tableInsertEntityAsync(tableName, entity);
    } catch (error) {
      if (ErrorHelper.IsConflict(error)) {
        throw CreateError.Conflict(
          `Entity already exists in table ${tableName} partition ${entity.partitionKey} row ${entity.rowKey}`,
          error
        );
      }
      throw error;
    }
    const etag = result?.etag;
    displayTableRow(
      'TABLE INSERT',
      this._storageAccountName,
      tableName,
      entity,
      etag,
      debugShowTableOperations
    );
    return result;
  }

  private async tableRetrieveEntity(
    type: EntityMetadataType,
    tableName: string,
    partitionKey: string,
    rowKey: string
  ): Promise<any> {
    let tableEntity = await this.tableRetrieveEntityAsync(type, tableName, partitionKey, rowKey);
    const encryptedColumnNames = this.isTypeEncrypted(type);
    if (encryptedColumnNames) {
      tableEntity = await decryptTableEntity(
        partitionKey,
        rowKey,
        tableEntity,
        this.getEncryptionOptionsForType(type)
      );
    }
    displayTableRow(
      'TABLE GET',
      this._storageAccountName,
      tableName,
      tableEntity,
      encryptedColumnNames ? '(decrypted)' : '',
      debugShowTableOperations
    );
    return tableEntity;
  }

  private async tableDeleteEntity(tableName: string, partitionKey: string, rowKey: string): Promise<any> {
    const tableClient = this.getTableClient(tableName);
    return await tableClient.deleteEntity(partitionKey, rowKey);
  }

  private async tableCreateIfNotExists(type: EntityMetadataType, tableName: string): Promise<boolean> {
    try {
      await this._azureTableServiceClient.createTable(tableName);
      this._initializedTables.set(type, tableName);
      return true;
    } catch (error) {
      if (error.statusCode === 409) {
        // already exists
        return false;
      }
      console.warn(`tableCreateIfNotExists error: tableName=${tableName}, error=${error}`);
      throw error;
    }
  }

  private async tableDeleteEntireTable(type: EntityMetadataType, tableName: string): Promise<any> {
    // WARNING: a table can technically support multiple types of metadata.
    // This call may be more destructive than you would like as it can
    // delete other types.
    await this._azureTableServiceClient.deleteTable(tableName);
    this._initializedTables.delete(type);
  }

  private createQueryFromFixedQueryEnum(type: EntityMetadataType, query: IEntityMetadataFixedQuery): any {
    const get = EntityMetadataMappings.GetDefinition(type, TableSettings.TableQueries, true);
    return get(query, this.getFixedPartitionKey(type));
  }

  getSerializationHelper(type: EntityMetadataType): IEntityMetadataSerializationHelper {
    const tableMapping = EntityMetadataMappings.GetDefinition(type, TableSettings.TableMapping, true);
    if (!tableMapping) {
      return null;
    }
    const alternateIdFieldName = EntityMetadataMappings.GetDefinition(
      type,
      TableSettings.TableNoPointQueryAlternateIdFieldName,
      false
    );
    const supportsPointQuery = this.supportsPointQueryForType(type);
    const idFieldName = supportsPointQuery
      ? EntityMetadataMappings.GetDefinition(type, MetadataMappingDefinition.EntityIdColumnName, false)
      : alternateIdFieldName;
    const noPointQueryMapObjectToTableFields = EntityMetadataMappings.GetDefinition(
      type,
      TableSettings.TableNoPointQueryMapping,
      false
    );
    const mapObjectToTableFields =
      !supportsPointQuery && noPointQueryMapObjectToTableFields
        ? mergeMaps(tableMapping, noPointQueryMapObjectToTableFields)
        : tableMapping;
    const specializedSerializer = EntityMetadataMappings.GetDefinition(
      type,
      TableSettings.TableSpecializedSerializationHelper,
      false
    );
    return function objectToTable(object: any): IEntityMetadata {
      if (!supportsPointQuery && !object[idFieldName]) {
        // CONSIDER: it might be best if the serialization helpers took options, and so only when
        // a new object is being created through the appropriate code path would this identify
        // get created.
        object[idFieldName] = randomUUID(); // new entity to insert
      }
      const entity = SerializeObjectToEntityMetadata(
        type,
        idFieldName,
        object,
        mapObjectToTableFields,
        true /* numbers to strings */,
        false /* throw if missing translations */,
        true /* ignore private variables */
      );
      if (specializedSerializer) {
        specializedSerialize(entity, object, specializedSerializer);
      }
      return entity;
    };
  }

  getDeserializationHelper(type: EntityMetadataType): IEntityMetadataDeserializationHelper {
    const tableMapping = EntityMetadataMappings.GetDefinition(type, TableSettings.TableMapping, true);
    if (!tableMapping) {
      return null;
    }
    const idFieldName = EntityMetadataMappings.GetDefinition(
      type,
      MetadataMappingDefinition.EntityIdColumnName,
      true
    );
    const alternateIdFieldName = EntityMetadataMappings.GetDefinition(
      type,
      TableSettings.TableNoPointQueryAlternateIdFieldName,
      false
    );
    const possibleDateColumnNames = EntityMetadataMappings.GetDefinition(
      type,
      TableSettings.TablePossibleDateColumns,
      false
    );
    const noPointQueryMapObjectToTableFields = EntityMetadataMappings.GetDefinition(
      type,
      TableSettings.TableNoPointQueryMapping,
      false
    );
    const supportsPointQuery = this.supportsPointQueryForType(type);
    const specializedDeserializer = EntityMetadataMappings.GetDefinition(
      type,
      TableSettings.TableSpecializedDeserializationHelper,
      false
    );
    const mapObjectToTableFields =
      !supportsPointQuery && noPointQueryMapObjectToTableFields
        ? mergeMaps(tableMapping, noPointQueryMapObjectToTableFields)
        : tableMapping;
    return function tableEntityToObject(entity: IEntityMetadata): any {
      const object = EntityMetadataMappings.InstantiateObject(type) as IObjectWithDefinedKeys;
      const toSet = DeserializeEntityMetadataToObjectSetCollection(
        entity,
        idFieldName,
        mapObjectToTableFields
      );
      const fieldSet = new Set(
        object.getObjectFieldNames ? object.getObjectFieldNames() : Object.getOwnPropertyNames(toSet)
      ); // IObjectWithDefinedKeys is not required
      for (const property in toSet) {
        let value = toSet[property];
        if (possibleDateColumnNames.includes(property)) {
          if (typeof value === 'string' || value instanceof Date) {
            let date = tryGetDate(value);
            if (date && !isFinite(date as any as number)) {
              date = null;
            }
            if (date) {
              value = date;
            } else {
              value = undefined;
            }
          }
        }
        object[property] = value;
        if (!fieldSet.has(property) && property !== alternateIdFieldName) {
          object.getObjectFieldNames().push(property);
        }
      }
      if (specializedDeserializer) {
        specializedDeserialize(entity, object, specializedDeserializer);
      }
      return object;
    };
  }

  private async tableReplaceEntityAsync(tableName: string, entity: any): Promise<any> {
    const tableClient = this.getTableClient(tableName);
    await tableClient.updateEntity(entity, 'Replace');
  }

  private async tableInsertEntityAsync(tableName: string, entity: any): Promise<any> {
    const tableClient = this.getTableClient(tableName);
    return await tableClient.createEntity(entity);
  }

  private async tableRetrieveEntityAsync(
    type: EntityMetadataType,
    tableName: string,
    partitionKey: string,
    rowKey: string
  ): Promise<any> {
    const tableClient = this.getTableClient(tableName);
    const tableEntity = await tableClient.getEntity(partitionKey, rowKey);
    return tableEntity;
  }

  private async tableQueryEntitiesAsync(
    tableName: string,
    azureTableQuery: TableEntityQueryOptions,
    continuationToken?: string
  ): Promise<AzureDataTablesQueryResponse> {
    const tableClient = this.getTableClient(tableName);
    const listResults = tableClient.listEntities({
      queryOptions: azureTableQuery,
    });
    const iterateByPage = listResults.byPage({
      continuationToken,
    });
    let singleResponse: AzureDataTablesQueryResponse = [];
    for await (const page of iterateByPage) {
      singleResponse = page;
      break;
    }
    return singleResponse;
  }
}

function specializedDeserialize(entity: IEntityMetadata, object: any, specializedDeserializer) {
  try {
    specializedDeserializer(entity, object);
  } catch (deserializationError) {
    const error = new Error(
      `Specialized deserializer defined for type ${entity.entityType} failed deserializing an entity id=${entity.entityId}: ${deserializationError.message}`
    );
    error['inner'] = deserializationError;
    error['entity'] = entity;
    throw error;
  }
}

function specializedSerialize(entity: IEntityMetadata, object: any, specializedSerializer) {
  try {
    specializedSerializer(entity, object);
    const currentKeys = new Set(entity.entityFieldNames);
    const keys = Object.getOwnPropertyNames(entity);
    keys.forEach((key) => {
      if (!currentKeys.has(key) && !EntityFieldNames.has(key) && !key.startsWith('_') /* no private vars */) {
        entity.entityFieldNames.push(key); // net new field added
      }
    });
  } catch (serializationError) {
    const error = new Error(
      `Specialized serializer defined for type ${entity.entityType} failed serializing to an entity id=${entity.entityId}: ${serializationError.message}`
    );
    error['inner'] = serializationError;
    error['entity'] = entity;
    throw error;
  }
}

function mergeMaps(mapA: Map<string, string>, mapB: Map<string, string>) {
  return new Map([...mapA, ...mapB]);
}

function getContinuationToken(result: AzureDataTablesQueryResponse): string {
  return result?.continuationToken || null;
}

function tryGetDate(value: any) {
  if (!value) {
    return;
  }
  if (typeof value === 'string' && !isNaN(value as any)) {
    value = Number(value);
  }
  try {
    const date = new Date(value);
    if (isFinite(date as any as number)) {
      return date;
    }
  } catch (dateError) {
    console.dir(dateError);
  }
  console.warn(`value did not produce a valid date ${value}`);
  // undefined
}

function displayTableQuery(
  header: string,
  accountName: string,
  tableName: string,
  query: TableEntityQueryOptions,
  footer?: string,
  output = true
) {
  const entity = {};
  if (query['_where'] && Array.isArray(query['_where'])) {
    const w = query['_where'] as string[];
    entity['where'] = { _: w.join('') };
  } else {
    entity['query'] = { _: query.toString() };
  }
  displayTableRow(header, accountName, tableName, entity, footer, output);
}

function displayTableRow(
  header: string,
  accountName: string,
  tableName: string,
  entity: any,
  footer?: string,
  output = true
) {
  if (!output) {
    return;
  }
  const log = [];
  const keys = Object.getOwnPropertyNames(entity);
  const list = [];
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    if (key === 'odata.metadata') {
      continue;
    }
    let value = entity[key];
    if (value?.type && value?.value) {
      value = value.value;
    }
    list.push(`${key}=${value}`);
  }
  if (header) {
    log.push(header);
    log.push('-'.repeat(header.length));
  }
  const tableInfo = `${accountName}/${tableName}`;
  log.push(tableInfo);
  log.push('='.repeat(tableInfo.length));
  log.push(list.join(', '));
  if (footer) {
    log.push('-'.repeat(footer.length));
    log.push(footer);
  }
  console.log(log.join('\n'));
  console.log();
}

function defaultRowKeyPrefixes() {
  const defaults = {};
  EntityMetadataTypes.forEach((type) => {
    if (!EntityMetadataMappings.GetDefinition(type, TableSettings.TableMapping, false)) {
      return;
    }
    const rowKeyPrefix = EntityMetadataMappings.GetDefinition(
      type,
      TableSettings.TableDefaultRowKeyPrefix,
      false
    );
    defaults[type.typeName] = rowKeyPrefix;
  });
  return defaults;
}

function defaultFixedPartitionKeys(prefix: string) {
  const defaults = {};
  EntityMetadataTypes.forEach((type) => {
    try {
      if (!EntityMetadataMappings.GetDefinition(type, TableSettings.TableMapping, false)) {
        return;
      }
      const partitionKey = EntityMetadataMappings.GetDefinition(
        type,
        TableSettings.TableDefaultFixedPartitionKey,
        true
      );
      const skipPrefix = EntityMetadataMappings.GetDefinition(
        type,
        TableSettings.TableDefaultFixedPartitionKeyNoPrefix,
        false
      );
      defaults[type.typeName] = skipPrefix ? partitionKey : `${prefix || ''}${partitionKey}`;
    } catch (error) {
      throw new Error(`No default Azure table fixed partition key defined for type ${type}`);
    }
  });
  return defaults;
}

function defaultTableNames() {
  const defaults = {};
  EntityMetadataTypes.forEach((type) => {
    try {
      if (!EntityMetadataMappings.GetDefinition(type, TableSettings.TableMapping, false)) {
        return;
      }
      const tableName = EntityMetadataMappings.GetDefinition(type, TableSettings.TableDefaultTableName, true);
      defaults[type.typeName] = tableName;
    } catch (error) {
      throw new Error(`No default Azure table name defined for type ${type} (${error})`);
    }
  });
  return defaults;
}

function defaultEncryptionColumns() {
  const defaults = {};
  EntityMetadataTypes.forEach((type) => {
    if (!EntityMetadataMappings.GetDefinition(type, TableSettings.TableMapping, false)) {
      return;
    }
    const encryptedColumnNames = EntityMetadataMappings.GetDefinition(
      type,
      TableSettings.TableEncryptedColumnNames,
      false
    );
    if (encryptedColumnNames) {
      defaults[type.typeName] = new Set(encryptedColumnNames);
    }
  });
  return defaults;
}

export class TableConfiguration {
  static SetDefaultTableName(type: EntityMetadataType, tableName: string) {
    EntityMetadataMappings.Register(type, TableSettings.TableDefaultTableName, tableName);
  }

  static SetNoPrefixForPartitionKey(type: EntityMetadataType) {
    EntityMetadataMappings.Register(type, TableSettings.TableDefaultFixedPartitionKeyNoPrefix, true);
  }

  static SetFixedPartitionKey(type: EntityMetadataType, partitionKey: string) {
    EntityMetadataMappings.Register(type, TableSettings.TableDefaultFixedPartitionKey, partitionKey);
  }

  static SetDateColumns(type: EntityMetadataType, dateColumns: string[]) {
    EntityMetadataMappings.Register(type, TableSettings.TablePossibleDateColumns, dateColumns);
  }

  static MapFieldsToColumnNames(
    type: EntityMetadataType,
    map: Map<string, string>,
    lowercaseColumnNamesAutomatically?: boolean
  ) {
    const dest = new Map<string, string>();
    for (const [key, value] of map.entries()) {
      dest.set(key, lowercaseColumnNamesAutomatically ? value.toLowerCase() : value);
    }
    EntityMetadataMappings.Register(type, TableSettings.TableMapping, dest);
  }

  static MapFieldsToColumnNamesFromListLowercased(type: EntityMetadataType, fieldNames: string[]) {
    TableConfiguration.MapFieldsToColumnNames(
      type,
      new Map(
        fieldNames.map((fieldName) => {
          return [fieldName, fieldName];
        })
      ),
      true
    );
  }
}
