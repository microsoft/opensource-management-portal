//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

// OUT-OF-DATE: not as up-to-date as the postgres provider that is completely functional now

// This wrapper also implements table row encryption at rest.

'use strict';

const _ = require('lodash');
const azure = require('azure-storage');

import async = require('async');
import { v4 as uuidV4 } from 'uuid';
import { IReposError } from '../../../transitional';
import { ILinkProvider } from '../postgres/postgresLinkProvider';
import { ICorporateLinkProperties, ICorporateLink, ICorporateLinkExtended, CorporatePropertyNames } from '../../../business/corporateLink';
import { CorporateTableLink } from './tableLink';

const tableEntity = require('../../tableEntity');
const tableEncryption = require('../../tableEncryption');

const defaultThirdPartyType = 'github';
const defaultPageSize = 500;
const defaultTableName = 'links';

const linkProviderInstantiationTypeProperty = '_i';
const dehydratedIdentityKey = '_lpi';
const dehydratedTableProviderName = 'xtable';
const dehydratedTableProviderVersion = '0';
const dehydratedTableProviderIdentitySeperator = '_';
const dehydratedTableProviderIdentity = `${dehydratedTableProviderName}${dehydratedTableProviderIdentitySeperator}${dehydratedTableProviderVersion}`;

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

const defaultEncryptedPropertyNames = [
  'githubToken',
  'githubTokenIncreasedScope',
  'localDataKey',
];

export interface ITableLinkProperties extends ICorporateLinkProperties {
  linkId: string;
  created: string;
}

const linkInterfacePropertyMapping : ITableLinkProperties = {
  linkId: 'linkid',

  isServiceAccount: 'serviceAccount',
  serviceAccountMail: 'serviceAccountMail',

  corporateId: 'aadoid',
  corporateUsername: 'aadupn',
  corporateDisplayName: 'aadname',

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
  'serviceAccount',
  'serviceAccountMail',
  'linkid',
];
// const coreColumnsList = coreColumns.join(', ');

export class TableLinkProvider implements ILinkProvider {
  private _tableName: string;
  private _tableNamePrefix: string;
  private _table: any;
  private _providers: any;
  private _entityGenerator: any;
  private _options: any;
  private _thirdPartyType: string;

  public readonly propertyMapping: ITableLinkProperties = linkInterfacePropertyMapping;

  public readonly serializationIdentifierVersion: string = dehydratedTableProviderIdentity;

  constructor(providers, options) {
    if (!providers) {
      throw new Error('The TableLinkProvider requires that available providers are passed into the constructor');
    }

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

    this._providers = providers;
    this._options = options;
  }

  initialize(callback) {
    const options = this._options || {};

    let table = null;
    try {
      table = azure.createTableService(options.account, options.key);
    } catch (storageAccountError) {
      return callback(storageAccountError);
    }

    this._table = table;
    this._entityGenerator = azure.TableUtilities.entityGenerator;

    this._tableNamePrefix = options.prefix || '';
    this._tableName = options.tableName || `${this._tableNamePrefix}${defaultTableName}`;

    if (options.encryption) {
      try {
        configureTableEncryption(this, options);
      } catch (encryptionInitializationError) {
        return callback(encryptionInitializationError);
      }
    }

    const tableClient = this._table;

    if (options.throwIfTableMissing) {
      tableClient.doesTableExist(this._tableName, (tableError, tableInfo) => {
        if (!tableError && !tableInfo.exists) {
          tableError = new Error(`The table named "${this._tableName}" does not exist. With options.throwIfTableMissing set, this error is thrown.`);
        }
        return callback(tableError ? tableError : null, tableError ? null : this);
      });
    } else {
      tableClient.createTableIfNotExists(this._tableName, callbackProvidesThisOnSuccess(this, callback));
    }
  }

  get thirdPartyType() {
    return this._thirdPartyType;
  }

  getByThirdPartyUsername(username, callback) {
    username = username.toLowerCase();
    // NOTE: this is not normalized in the current data set!!!!!!!!
    // TODO: NOT NORMALIZED
    // TODO: VALUES in the current table have usernames that are MIXED CASE!!!!!!
    return getSingleLinkByProperty(this, this.propertyMapping.thirdPartyUsername, username, callback);
  }

  getByThirdPartyId(id, callback) {
    const self = this;
    if (typeof(id) !== 'string') {
      id = id.toString();
    }
    // Legacy table design: this call actually can go direct; in the
    // original implementation, the partition key is fixed and the
    // row key is simply the string value of the GitHub user ID.

    // SLOW query equivalent: return getUserEntityByProperty(this, 'ghid', id, callback);

    const partitionKey = this._options.partitionKey;
    if (!partitionKey) {
      return callback(new Error('No table options.partitionKey provided with a fixed partition key at this time'));
    }

    const tableName = this._tableName;

    this._table.retrieveEntity(tableName, partitionKey, id, (getError, fullEntity) => {
      if (getError && getError.statusCode === 404) {
        return callback(null, false);
      }
      if (getError) {
        return callback(getError);
      }
      const row = tableEntity.reduce(fullEntity);
      const link = createLinkInstanceFromAzureTableEntity(self, row);
      return callback(null, link);
    });
  }

  queryByCorporateId(id, callback) {
    return getLinksByProperty(this, 'aadoid', id, callback);
  }

  getAll(callback) {
    const self = this;
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

    return queryLinksTable(this, queryOptions, (error, unsorted) => {
      if (error) {
        return callback(error);
      }

      const sorted = _.sortBy(unsorted, ['aadupn', 'ghu']);
      const links = createLinkInstancesFromAzureTableEntityArray(self, sorted);
      return callback(null, links);
    });
  }

  queryByCorporateUsername(username, callback) {
    // ?? username = username.toLowerCase();
    // TODO: not sure if this one is normalized or not...
    return getLinksByProperty(this, 'aadupn', username, callback);
  }

  createLink(link: ICorporateLink, callback: (error: any, newLinkId: string) => void) {
    const generatedLinkId = uuidV4();
    const tableName = this._tableName;
    let entity = null;
    try {
      const initialEntity = {};
      initialEntity[linkInterfacePropertyMapping.linkId] = generatedLinkId;

      for (let linkPropertyName of CorporatePropertyNames) {
        // linkInterfacePropertyMapping
        const tableColumnName = linkInterfacePropertyMapping[linkPropertyName];
        if (!tableColumnName) {
          return callback(new Error(`Missing mapping from property ${linkPropertyName} to equivalent table column`), null);
        }
        initialEntity[tableColumnName] = link[linkPropertyName];
      }

      const partitionKey = this._options.partitionKey;
      if (!partitionKey) {
        return callback(new Error('No table options.partitionKey provided with a fixed partition key at this time'), null);
      }
      entity = tableEntity.create(partitionKey, link.thirdPartyId, initialEntity);
    } catch (processingError) {
      return callback(processingError, null);
    }
    return this._table.insertEntity(tableName, entity, (insertError, inserted) => {
      if (insertError && insertError.code === 'EntityAlreadyExists') {
        const error: IAlreadyLinkedError = new Error('This user is already linked');
        error.alreadyLinked = true;
        error.innerError = insertError;
        return callback(error, null);
      }
      if (insertError) {
        return callback(insertError, null);
      }
      return callback(null, generatedLinkId);
    });
  }

  updateLink(linkInstance: ICorporateLink, callback) {
    const tl = linkInstance as CorporateTableLink;
    const replacementEntity = tl.internal().getDirectEntity();
    if (linkInstance.thirdPartyId) {
      return this.updateLinkByThirdPartyIdLegacy(linkInstance.thirdPartyId, replacementEntity, callback);
    }
    return callback(new Error('updateLink is not yet updated for linkId without a given thirdPartyId (ghid)'));
  }

  deleteLink(linkInstance: ICorporateLink, callback) {
    // This is inefficient at this time; with the newer design centering
    // around a link ID, this has to query first.
    const tl = linkInstance as CorporateTableLink;
    const linkId = tl.id;
    if (!linkId && linkInstance.thirdPartyId) {
      return this.deleteLinkByThirdPartyIdLegacy(linkInstance.thirdPartyId, callback);
    }
    return getSingleLinkByProperty(this, this.propertyMapping.linkId, linkId, (queryError, link: ICorporateLink) => {
      if (!queryError && !link) {
        queryError = new Error(`No link found with ID ${linkId}`);
      }
      if (!queryError && !link.thirdPartyId) {
        queryError = new Error(`Link ${linkId} is missing a valid thirdPartyId`);
      }
      if (queryError) {
        return callback(queryError);
      }
      return this.deleteLinkByThirdPartyIdLegacy(link.thirdPartyId, callback);
    });
  }

  updateLinkByThirdPartyIdLegacy(thirdPartyId, replaceEntity, callback) {
    const partitionKey = this._options.partitionKey;
    if (!partitionKey) {
      return callback(new Error('No table options.partitionKey provided with a fixed partition key at this time'));
    }
    if (typeof(thirdPartyId) !== 'string') {
      thirdPartyId = thirdPartyId.toString();
    }
    const tableName = this._tableName;
    if (!replaceEntity.linkId) {
      console.log('Generated a new linkId as part of an update operation');
      const newLinkId = uuidV4();
      replaceEntity.linkId = newLinkId;
    }
    const entity = tableEntity.create(partitionKey, thirdPartyId, replaceEntity);
    return this._table.replaceEntity(tableName, entity, callback);
  }

  deleteLinkByThirdPartyIdLegacy(thirdPartyId, callback) {
    const partitionKey = this._options.partitionKey;
    if (!partitionKey) {
      return callback(new Error('No table options.partitionKey provided with a fixed partition key at this time'));
    }
    if (typeof(thirdPartyId) !== 'string') {
      thirdPartyId = thirdPartyId.toString();
    }
    const tableName = this._tableName;
    this._table.deleteEntity(tableName, tableEntity.create(partitionKey, thirdPartyId), callback);
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
      const sameProviderType = identity.startsWith(`${dehydratedTableProviderName}${dehydratedTableProviderIdentitySeperator}`);
      if (sameProviderType) {
        // Cross-version rehydration not supported
        throw new Error(`The hydrated link was created by the same ${dehydratedTableProviderName} provider, but a different version: ${identity}`);
      } else {
        throw new Error(`The hydrated link is incompatible with this runtime environment: ${identity}`);
      }
    }
    const clonedObject = Object.assign({}, jsonObject);
    delete clonedObject[dehydratedIdentityKey];
    const pglink = createLinkInstanceFromHydratedEntity(this, clonedObject);
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
}

function createLinkInstancesFromAzureTableEntityArray(provider: TableLinkProvider, rows: any[]) {
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

function createLinkInstanceFromHydratedEntity(self, jsonObject) {
  const linkInternalOptions = {
    provider: self,
  };
  const newLink = new CorporateTableLink(linkInternalOptions, jsonObject);
  newLink[linkProviderInstantiationTypeProperty] = LinkInstantiatedType.Rehydrated; // in case this helps while debugging
  return newLink;
}

function getUserEntitiesByProperty(self, propertyName, value, callback) {
  const queryOptions = {
    wherePropertyName: propertyName,
    whereValue: value,
  };
  return queryLinksTable(self, queryOptions, callback);
}

function getLinksByProperty(self, propertyName, value, callback) {
  return getUserEntitiesByProperty(self, propertyName, value, (error, rows) => {
    if (error) {
      return callback(error);
    }
    const links = createLinkInstancesFromAzureTableEntityArray(self, rows);
    return callback(null, links);
  });
}

function getSingleLinkByProperty(self, propertyName, value, callback) {
  return getUserEntitiesByProperty(self, propertyName, value, (getError, rows) => {
    if (getError) {
      return callback(getError);
    }
    if (rows.length <= 0) {
      return callback(null, false);
    }
    if (rows.length > 1) {
      const error: IMultipleResultsError = new Error(`More than a single result were returned by the query (${rows.length})`);
      error.multipleResults = rows.length;
      return callback(error);
    }
    const entityRow = rows[0];
    const link = createLinkInstanceFromAzureTableEntity(self, entityRow);
    return callback(null, link);
  });
}

function getTableName(self) {
  // setup during init
  return self._tableName;
}

function getTableService(self) {
  // setup during init
  return self._table;
}

function queryLinksTable(self, options, callback) {
  function buildQuery(options) {
    let q = new azure.TableQuery();
    if (options.columns) {
      q = q.select(options.columns);
    }
    if (options.wherePropertyName && options.whereValue) {
      q = q.where(`${options.wherePropertyName} eq ?`, options.whereValue);
    }
    const pageSize = options.pageSize || defaultPageSize;
    q = q.top(pageSize);
    return q;
  }

  const tableName = options.tableName || getTableName(self);
  const rows = [];

  let continuationToken = null;
  let done = false;

  async.whilst(
    () => {
      return !done;
    },
    next => {
      const tableService = getTableService(self);
      tableService.queryEntities(tableName, buildQuery(options), continuationToken, (queryError, results) => {
        if (queryError) {
          done = true;
          return next(queryError);
        }

        // Is there another page of query results?
        if (results.continuationToken) {
          continuationToken = results.continuationToken;
        } else {
          done = true;
        }

        // NOTE: This function does not use continuation tokens or anything like that!
        const entries = results && results.entries ? results.entries : null;
        for (let i = 0; entries && i < entries.length; i++) {
          rows.push(tableEntity.reduce(entries[i]));
        }

        return next(null, rows);
      });
    },
    error => {
      if (error) {
        return callback(error);
      }

      // TODO: The legacy provider was wasting time with the following, can we normalize as part of data fixes?
      /*
      employees.forEach(account => {
        if (account.aadupn) {
          account.aadupn = account.aadupn.toLowerCase();
        }
      });
      */

      return callback(null, rows);
    });
}

function configureTableEncryption(self, options) {
  const encryptionOptions = options.encryption;

  const encryptionKeyId = encryptionOptions.encryptionKeyId;
  if (!encryptionKeyId) {
    throw new Error('Encryption requires options.encryptionKeyId');
  }

  const keyResolver = encryptionOptions.keyEncryptionKeyResolver;
  if (!keyResolver) {
    throw new Error('Encryption requires options.keyResolver');
  }

  const encryptedPropertyNames = new Set(encryptionOptions.encryptedPropertyNames || defaultEncryptedPropertyNames);

  const opts = {
    keyEncryptionKeyId: encryptionKeyId,
    keyResolver: keyResolver,
    encryptedPropertyNames: encryptedPropertyNames,
    binaryProperties: 'buffer',
    tableDehydrator: encryptionOptions.tableDehydrator || tableEntity.reduce,
    tableRehydrator: encryptionOptions.tableRehydrator || tableEntity.create,
  };

  // re-wrap the table client with the encrypting variant
  const standardTableClient = self._table;
  self._table = tableEncryption(standardTableClient, opts);
}

function callbackProvidesThisOnSuccess(self, callback) {
  const capturedSelf = self;
  return error => {
    if (error) {
      return callback(error);
    }
    return callback(null, capturedSelf);
  };
}
