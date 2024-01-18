//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import _ from 'lodash';
import { randomUUID } from 'crypto';

import {
  AzureNamedKeyCredential,
  GetTableEntityResponse,
  odata,
  TableClient,
  TableEntityQueryOptions,
  TableEntityResult,
  TableServiceClient,
} from '@azure/data-tables';

import {
  ICorporateLink,
  ICorporateLinkExtended,
  ICorporateLinkProperties,
  IProviders,
  IReposError,
} from '../../../interfaces';
import { CorporatePropertyNames } from '../../../business/corporateLink';
import { CorporateTableLink } from './tableLink';
import { ILinkProvider } from '..';

import tableEntity from '../../tableEntity';
import { ErrorHelper } from '../../transitional';
import { decryptEntityAsync, encryptEntityAsync, IEncryptionOptions } from '../../encryption';
import { IKeyVaultSecretResolver } from '../../keyVaultResolver';

const defaultThirdPartyType = 'github';
// const defaultPageSize = 500;
const defaultTableName = 'links';

const linkProviderInstantiationTypeProperty = '_i';
const dehydratedIdentityKey = '_lpi';
const dehydratedTableProviderName = 'xtable';
const dehydratedTableProviderVersion = '0';
const dehydratedTableProviderIdentitySeparator = '_';
const dehydratedTableProviderIdentity = `${dehydratedTableProviderName}${dehydratedTableProviderIdentitySeparator}${dehydratedTableProviderVersion}`;

enum LinkInstantiatedType {
  AzureTableEntity,
  Rehydrated,
}

interface IAlreadyLinkedError extends IReposError {
  alreadyLinked?: boolean;
}

interface IMultipleResultsError extends IReposError {
  multipleResults?: boolean;
}

// prettier-ignore
const defaultEncryptedPropertyNames = [
  'githubToken',
  'githubTokenIncreasedScope',
  'localDataKey',
];

export interface ITableLinkProperties extends ICorporateLinkProperties {
  linkId: string;
  created: string;
}

const linkInterfacePropertyMapping: ITableLinkProperties = {
  linkId: 'linkid',

  isServiceAccount: 'serviceAccount',
  serviceAccountMail: 'serviceAccountMail',

  corporateId: 'aadoid',
  corporateUsername: 'aadupn',
  corporateDisplayName: 'aadname',
  corporateMailAddress: 'corporateMailAddress', // NOTE: this was not part of the original table entity
  corporateAlias: 'corporateAlias', // NOTE: this was not part of the original table entity

  thirdPartyId: 'ghid',
  thirdPartyUsername: 'ghu',
  thirdPartyAvatar: 'ghavatar',

  created: 'Timestamp',
};

const coreColumns = [
  'ghid',
  'ghu',
  'ghavatar',
  'aadoid',
  'aadupn',
  'aadname',
  'corporateMailAddress',
  'serviceAccount',
  'serviceAccountMail',
  'linkid',
];
// const coreColumnsList = coreColumns.join(', ');

interface ITableLinkProviderEncryptionOptions {
  encryptedPropertyNames: string[];
  encryptionKeyId: string;
  keyEncryptionKeyResolver: IKeyVaultSecretResolver;
  tableDehydrator: (instance: any) => any;
  tableRehydrator: (partitionKey: string, rowKey: string, obj?: any, callback?: any) => any;
}

interface ITableLinkProviderOptions {
  encryption?: ITableLinkProviderEncryptionOptions;
  thirdPartyType?: string;
  account?: string;
  key?: string;
  tableName?: string;
  prefix?: string;
  throwIfTableMissing?: boolean;
  partitionKey?: string;
}

interface IQueryLinksOptions {
  pageSize?: number;
  columns?: string[];
  wherePropertyName?: string;
  whereValue?: string;
}

export class TableLinkProvider implements ILinkProvider {
  private _tableName: string;
  private _tableNamePrefix: string;
  private _tableService: TableServiceClient;
  private _tableClient: TableClient;
  private _options: ITableLinkProviderOptions;
  private _thirdPartyType: string;
  private _encryptionOptions: IEncryptionOptions;

  public readonly propertyMapping: ITableLinkProperties = linkInterfacePropertyMapping;

  public readonly serializationIdentifierVersion: string = dehydratedTableProviderIdentity;

  constructor(providers: IProviders, options: ITableLinkProviderOptions) {
    options = options || {};
    const thirdPartyType = options.thirdPartyType || defaultThirdPartyType;
    if (thirdPartyType !== 'github') {
      throw new Error('At this time only "github" is a supported third-party type.');
    }
    const storageAccountName = options.account;
    if (!storageAccountName) {
      throw new Error('Must provide options.account with an Azure Table storage account name');
    }
    const storageAccountKey = options.key;
    if (!storageAccountKey) {
      throw new Error('Must provide options.key with an Azure Table storage account key');
    }
    this._options = options;
  }

  async initialize(): Promise<ILinkProvider> {
    const options = this._options || {};

    const azureTableCredential = new AzureNamedKeyCredential(options.account, options.key);
    const serviceUrl = `https://${options.account}.table.core.windows.net`;
    this._tableService = new TableServiceClient(serviceUrl, azureTableCredential);
    this._tableNamePrefix = options.prefix || '';
    this._tableName = options.tableName || `${this._tableNamePrefix}${defaultTableName}`;
    if (options.encryption?.encryptionKeyId) {
      const encryptionOptions = options.encryption;
      const encryptionKeyId = encryptionOptions.encryptionKeyId;
      if (!encryptionKeyId) {
        throw new Error('Encryption requires options.encryptionKeyId');
      }
      const keyResolver = encryptionOptions.keyEncryptionKeyResolver;
      if (!keyResolver) {
        throw new Error('Encryption requires options.keyResolver');
      }
      const encryptedPropertyNames = new Set<string>(
        encryptionOptions.encryptedPropertyNames || defaultEncryptedPropertyNames
      );
      this._encryptionOptions = {
        keyEncryptionKeyId: encryptionKeyId,
        keyResolver,
        encryptionResolver: undefined,
        keyEncryptionKeys: undefined,
        encryptedPropertyNames,
        binaryProperties: 'buffer',
        tableDehydrator: encryptionOptions.tableDehydrator || tableEntity.reduce,
        tableRehydrator: encryptionOptions.tableRehydrator || tableEntity.create,
      };
    }
    this._tableClient = new TableClient(serviceUrl, this._tableName, azureTableCredential);
    if (options.throwIfTableMissing) {
      let tableExists = false;
      try {
        tableExists = await this.doesTableNameExist(this._tableName);
      } catch (tableError) {
        throw tableError;
      }
      if (!tableExists) {
        throw new Error(
          `The table named "${this._tableName}" does not exist. With options.throwIfTableMissing set, this error is thrown.`
        );
      }
    } else {
      await this.tableCreateIfNotExists(this._tableName);
    }
    return this as any as ILinkProvider;
  }

  get thirdPartyType() {
    return this._thirdPartyType;
  }

  getByThirdPartyUsername(username: string): Promise<CorporateTableLink> {
    username = username.toLowerCase();
    // NOTE: this is not normalized in the current data set!!!!!!!!
    // TODO: NOT NORMALIZED
    // TODO: VALUES in the current table have usernames that are MIXED CASE!!!!!!
    return this.getSingleLinkByProperty(
      this.propertyMapping.thirdPartyUsername,
      username
    ) as Promise<CorporateTableLink>;
  }

  async getByThirdPartyId(id: string): Promise<CorporateTableLink> {
    if (typeof id !== 'string') {
      id = (id as any).toString();
    }
    // Legacy table design: this call actually can go direct; in the
    // original implementation, the partition key is fixed and the
    // row key is the string value of the GitHub user ID.
    // SLOW query equivalent: return getUserEntityByProperty(this, 'ghid', id, callback);
    const partitionKey = this._options.partitionKey;
    if (!partitionKey) {
      throw new Error('No table options.partitionKey provided with a fixed partition key at this time');
    }
    const fullEntity = await this.tableRetrieveEntity(partitionKey, id);
    if (fullEntity === false) {
      return false as any as CorporateTableLink;
    }
    const row = tableEntity.reduce(fullEntity);
    const link = createLinkInstanceFromAzureTableEntity(this, row);
    return link;
  }

  queryByCorporateId(id: string): Promise<CorporateTableLink[]> {
    return this.getLinksByProperty('aadoid', id);
  }

  async getAll(): Promise<CorporateTableLink[]> {
    const queryOptions = {
      columns: [
        'aadoid',
        'aadupn',
        'aadname',
        'ghu',
        'ghid',
        'ghavatar',
        'serviceAccount',
        'serviceAccountMail',
        'PartitionKey',
        'RowKey',
        'Timestamp',
      ],
    };
    const unsorted = await this.queryLinksTable(queryOptions);
    const sorted = _.sortBy(unsorted, ['aadupn', 'ghu']);
    const links = createLinkInstancesFromAzureTableEntityArray(this, sorted);
    return links;
  }

  async getAllCorporateIds(): Promise<string[]> {
    const queryOptions = {
      // prettier-ignore
      columns: [
        'aadoid',
        'PartitionKey',
        'RowKey',
        'Timestamp',
      ],
    };
    const results = await this.queryLinksTable(queryOptions);
    return results.map((row) => String(row.aadoid)) as string[];
  }

  queryByCorporateUsername(username: string): Promise<CorporateTableLink[]> {
    // ?? username = username.toLowerCase();
    // TODO: not sure if this one is normalized or not...
    return this.getLinksByProperty('aadupn', username);
  }

  async createLink(link: ICorporateLink): Promise<string> {
    const generatedLinkId = randomUUID();
    let entity = null;
    try {
      const initialEntity = {};
      initialEntity[linkInterfacePropertyMapping.linkId] = generatedLinkId;
      for (const linkPropertyName of CorporatePropertyNames) {
        // linkInterfacePropertyMapping
        const tableColumnName = linkInterfacePropertyMapping[linkPropertyName];
        if (!tableColumnName) {
          throw new Error(`Missing mapping from property ${linkPropertyName} to equivalent table column`);
        }
        initialEntity[tableColumnName] = link[linkPropertyName];
      }
      const partitionKey = this._options.partitionKey;
      if (!partitionKey) {
        throw new Error('No table options.partitionKey provided with a fixed partition key at this time');
      }
      entity = tableEntity.create(partitionKey, link.thirdPartyId, initialEntity);
    } catch (processingError) {
      throw processingError;
    }
    await this.tableInsertEntity(entity, 'This user is already linked');
    return generatedLinkId;
  }

  updateLink(linkInstance: ICorporateLink): Promise<any> {
    const tl = linkInstance as CorporateTableLink;
    const replacementEntity = tl.internal().getDirectEntity();
    if (linkInstance.thirdPartyId) {
      return this.updateLinkByThirdPartyIdLegacy(linkInstance.thirdPartyId, replacementEntity);
    }
    throw new Error('updateLink is not yet updated for linkId without a given thirdPartyId (ghid)');
  }

  async deleteLink(linkInstance: ICorporateLink): Promise<any> {
    // This is inefficient at this time; with the newer design centering
    // around a link ID, this has to query first.
    const tl = linkInstance as CorporateTableLink;
    const linkId = tl.id;
    if (!linkId && linkInstance.thirdPartyId) {
      return this.deleteLinkByThirdPartyIdLegacy(linkInstance.thirdPartyId);
    }
    const link = (await this.getSingleLinkByProperty(
      this.propertyMapping.linkId,
      linkId
    )) as any as CorporateTableLink;
    if (!link) {
      throw new Error(`No link found with ID ${linkId}`);
    }
    if (!link.thirdPartyId) {
      throw new Error(`Link ${linkId} is missing a valid thirdPartyId`);
    }
    return this.deleteLinkByThirdPartyIdLegacy(link.thirdPartyId);
  }

  async updateLinkByThirdPartyIdLegacy(thirdPartyId: string, replaceEntity: any): Promise<void> {
    const partitionKey = this._options.partitionKey;
    if (!partitionKey) {
      throw new Error('No table options.partitionKey provided with a fixed partition key at this time');
    }
    if (typeof thirdPartyId !== 'string') {
      thirdPartyId = (thirdPartyId as any).toString();
    }
    if (!replaceEntity.linkId) {
      console.log('Generated a new linkId as part of an update operation');
      const newLinkId = randomUUID();
      replaceEntity.linkId = newLinkId;
    }
    const entity = tableEntity.create(partitionKey, thirdPartyId, replaceEntity);
    await this.tableReplaceEntity(entity);
  }

  deleteLinkByThirdPartyIdLegacy(thirdPartyId: string): Promise<void> {
    const partitionKey = this._options.partitionKey;
    if (!partitionKey) {
      throw new Error('No table options.partitionKey provided with a fixed partition key at this time');
    }
    if (typeof thirdPartyId !== 'string') {
      thirdPartyId = (thirdPartyId as any).toString();
    }
    return this.tableDeleteEntity(partitionKey, thirdPartyId);
  }

  dehydrateLink(linkInstance: ICorporateLinkExtended): any {
    // CONSIDER: check whether the current link type feels appropriate to us (PGSQL)
    const tlink = linkInstance as CorporateTableLink;
    const entity = tlink.internal().getDirectEntity();
    const shriveled = Object.assign({}, entity);
    shriveled[dehydratedIdentityKey] = dehydratedTableProviderIdentity;
    return shriveled;
  }

  rehydrateLink(jsonObject: any): ICorporateLink {
    if (!jsonObject) {
      throw new Error('No object provided to rehydrate');
    }
    const identity = jsonObject[dehydratedIdentityKey] as string;
    if (!identity) {
      throw new Error('No stored link provider identity to validate');
    }
    if (identity !== dehydratedTableProviderIdentity) {
      const sameProviderType = identity.startsWith(
        `${dehydratedTableProviderName}${dehydratedTableProviderIdentitySeparator}`
      );
      if (sameProviderType) {
        // Cross-version rehydration not supported
        throw new Error(
          `The hydrated link was created by the same ${dehydratedTableProviderName} provider, but a different version: ${identity}`
        );
      } else {
        throw new Error(`The hydrated link is incompatible with this runtime environment: ${identity}`);
      }
    }
    const clonedObject = Object.assign({}, jsonObject);
    delete clonedObject[dehydratedIdentityKey];
    const pglink = this.createLinkInstanceFromHydratedEntity(clonedObject);
    return pglink;
  }

  dehydrateLinks(linkInstances: ICorporateLink[]): any[] {
    if (!Array.isArray(linkInstances)) {
      throw new Error('linkInstances must be an array');
    }
    if (linkInstances.length > 0) {
      const first = linkInstances[0];
      if (first[linkProviderInstantiationTypeProperty] === undefined) {
        throw new Error('linkInstances[0] does not appear to be a link instantiated by a provider');
      }
    }
    //
    const arr: any[] = linkInstances.map(this.dehydrateLink.bind(this));
    return arr;
  }

  rehydrateLinks(jsonArray: any): ICorporateLink[] {
    if (!Array.isArray(jsonArray)) {
      throw new Error('jsonArray must be an array');
    }
    //
    const arr = jsonArray.map(this.rehydrateLink.bind(this));
    return arr as any[] as ICorporateLink[];
  }

  private createLinkInstanceFromHydratedEntity(jsonObject) {
    const linkInternalOptions = {
      provider: this,
    };
    const newLink = new CorporateTableLink(linkInternalOptions, jsonObject);
    newLink[linkProviderInstantiationTypeProperty] = LinkInstantiatedType.Rehydrated; // in case this helps while debugging
    return newLink;
  }

  private async getTableEntitiesByProperty(propertyName: string, value): Promise<any[]> {
    const queryOptions = {
      wherePropertyName: propertyName,
      whereValue: value,
    };
    return await this.queryLinksTable(queryOptions);
  }

  private async getLinksByProperty(propertyName, value): Promise<CorporateTableLink[]> {
    const rows = await this.getTableEntitiesByProperty(propertyName, value);
    const links = createLinkInstancesFromAzureTableEntityArray(this, rows);
    return links;
  }

  private async getSingleLinkByProperty(propertyName: string, value): Promise<CorporateTableLink | boolean> {
    const rows = await this.getTableEntitiesByProperty(propertyName, value);
    if (rows.length <= 0) {
      return false;
    }
    if (rows.length > 1) {
      const error: IMultipleResultsError = new Error(
        `More than a single result were returned by the query (${rows.length})`
      );
      error.multipleResults = rows.length > 0;
      throw error;
    }
    const entityRow = rows[0];
    const link = createLinkInstanceFromAzureTableEntity(this, entityRow);
    return link;
  }

  private async tableInsertEntity(entity: any, entityAlreadyExistsErrorMessage: string): Promise<any> {
    try {
      let entityObject = entity;
      if (this._encryptionOptions) {
        const rowKey = entity.rowKey as string;
        const partitionKey = entity.partitionKey as string;
        const encryptedObject = await encryptEntityAsync(
          partitionKey,
          rowKey,
          entityObject,
          this._encryptionOptions
        );
        entityObject = this._encryptionOptions.tableRehydrator(partitionKey, rowKey, encryptedObject);
      }
      await this._tableClient.createEntity(entityObject);
    } catch (insertError) {
      if (ErrorHelper.IsConflict(insertError)) {
        const error: IAlreadyLinkedError = new Error(entityAlreadyExistsErrorMessage, { cause: insertError });
        error.alreadyLinked = true;
        throw error;
      }
      throw insertError;
    }
  }

  private async queryLinksTable(options: IQueryLinksOptions): Promise<any[]> {
    const query: TableEntityQueryOptions = {
      select: options.columns || undefined,
    };
    if (options.wherePropertyName && options.whereValue) {
      const whereValue = odata`eq ${options.whereValue}`;
      query.filter = `${options.wherePropertyName} ${whereValue}`;
    }
    const rows = [];
    const pager = this._tableClient.listEntities({ queryOptions: query }).byPage();
    for await (const page of pager) {
      for (let i = 0; i < page.length; i++) {
        let row = page[i];
        if (this._encryptionOptions) {
          const { partitionKey, rowKey } = row;
          const reducedEntity = this._encryptionOptions.tableDehydrator(row);
          const decryptedEntity = await decryptEntityAsync(
            partitionKey,
            rowKey,
            reducedEntity,
            this._encryptionOptions
          );
          // CONSIDER: the original implementation called the rehydrator here... which seems unnecessary now.
          row = this._encryptionOptions.tableRehydrator(partitionKey, rowKey, decryptedEntity);
        }
        rows.push(row);
      }
    }
    return rows;
  }

  private async doesTableNameExist(tableName: string): Promise<boolean> {
    // The newer table client does not seem to have a simple "exist" check today...
    const iterateByPage = this._tableService.listTables().byPage();
    for await (const page of iterateByPage) {
      const present = page.filter((p) => p?.name === tableName);
      if (present.length > 0) {
        return true;
      }
    }
    return false;
  }

  private async tableCreateIfNotExists(tableName: string): Promise<void> {
    try {
      await this._tableService.createTable(tableName);
    } catch (error) {
      if (ErrorHelper.IsConflict(error)) {
        return;
      } else {
        throw error;
      }
    }
  }

  private async tableRetrieveEntity(
    partitionKey: string,
    rowKey: string
  ): Promise<false | GetTableEntityResponse<TableEntityResult<object>>> {
    try {
      let entity = await this._tableClient.getEntity(partitionKey, rowKey);
      if (this._encryptionOptions) {
        const reducedEntity = this._encryptionOptions.tableDehydrator(entity);
        const decryptedEntity = await decryptEntityAsync(
          partitionKey,
          rowKey,
          reducedEntity,
          this._encryptionOptions
        );
        const hydrated = this._encryptionOptions.tableRehydrator(partitionKey, rowKey, decryptedEntity);
        entity = hydrated;
      }
      return entity;
    } catch (error) {
      if (ErrorHelper.IsNotFound(error)) {
        return false;
      }
      throw error;
    }
  }

  private async tableReplaceEntity(entity: any): Promise<any> {
    let replacementObject = entity;
    if (this._encryptionOptions) {
      const reducedEntity = this._encryptionOptions.tableDehydrator(entity);
      const rowKey = entity.rowKey as string;
      const partitionKey = entity.partitionKey as string;
      const encryptedEntity = await encryptEntityAsync(
        partitionKey,
        rowKey,
        reducedEntity,
        this._encryptionOptions
      );
      replacementObject = this._encryptionOptions.tableRehydrator(partitionKey, rowKey, encryptedEntity);
    }
    await this._tableClient.updateEntity(replacementObject, 'Replace');
  }

  private async tableDeleteEntity(partitionKey: string, rowKey: string): Promise<any> {
    await this._tableClient.deleteEntity(partitionKey, rowKey);
  }
}

function createLinkInstancesFromAzureTableEntityArray(
  provider: TableLinkProvider,
  rows: any[]
): CorporateTableLink[] {
  return rows.map(createLinkInstanceFromAzureTableEntity.bind(null, provider));
}

function createLinkInstanceFromAzureTableEntity(provider: TableLinkProvider, row: any): CorporateTableLink {
  const linkInternalOptions = {
    provider,
  };
  const newLink = new CorporateTableLink(linkInternalOptions, row);
  newLink[linkProviderInstantiationTypeProperty] = LinkInstantiatedType.AzureTableEntity; // in case this helps while debugging
  return newLink;
}
