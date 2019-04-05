//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

/*eslint no-console: ["error", { allow: ["warn"] }] */

// THIS FILE IS GOING AWAY

const azure = require('azure-storage');
import async = require('async');
import { v4 as uuidV4 } from 'uuid';
import { IProviders } from './transitional';

const tableEntity = require('./lib/tableEntity');

const encryptionColumns = [
  'githubToken',
  'githubTokenIncreasedScope',
  'localDataKey',
];

export class DataClient {
  public options: any;
  private table: any;
  private entGen: any;
  private providers: IProviders;

  constructor(options, callback) {
    if (options.config === undefined) {
      return callback(new Error('Configuration must be provided to the data client.'));
    }
    if (!options.providers) {
      return new callback(new Error('options.providers was not provided to the DataClient'));
    }
    this.providers = options.providers as IProviders;
    var storageAccountName = options.config.github.links.table.account;
    var storageAccountKey = options.config.github.links.table.key;
    var prefix = options.config.github.links.table.prefix;
    try {
      if (!storageAccountName || !storageAccountKey) {
        // TODO: This whole file needs to go away
        console.warn('LEGACY DATA CLIENT: Storage account information is not configured.');
      } else {
        this.table = azure.createTableService(storageAccountName, storageAccountKey);
      }
    } catch (storageAccountError) {
      return callback(storageAccountError);
    }
    this.entGen = azure.TableUtilities.entityGenerator;
    if (prefix === undefined) {
      prefix = '';
    }
    this.options = {
      partitionKey: prefix + 'pk',
      linksTableName: prefix + 'links',
      pendingApprovalsTableName: prefix + 'pending',
      errorsTableName: prefix + 'errors',
      settingsTableName: `${prefix}settings`,
      encryption: options.config.github.links.table.encryption,
    };
    if (this.options.encryption === true) {
      const encryptColumns = new Set(encryptionColumns);
      const encryptionOptions = {
        keyEncryptionKeyId: options.config.github.links.table.encryptionKeyId,
        keyResolver: options.keyEncryptionKeyResolver,
        encryptedPropertyNames: encryptColumns,
        binaryProperties: 'buffer',
        tableDehydrator: this.reduceEntity.bind(this),
        tableRehydrator: this.createEntity.bind(this),
      };
      const tableClient = this.table;
      if (tableClient) {
        this.table = require('./lib/tableEncryption')(tableClient, encryptionOptions);
      }
    }
    var dc = this;
    var tableNames = [
      dc.options.linksTableName,
      dc.options.pendingApprovalsTableName,
      dc.options.errorsTableName,
      dc.options.settingsTableName,
    ];
    if (!this.table) {
      return callback();
    }
    async.each(tableNames, function (tableName, callback) {
      dc.table.createTableIfNotExists(tableName, callback);
    }, function (error) {
      if (callback) return callback(error, dc);
    });
  }

  reduceEntity(instance: any) {
    return tableEntity.reduce(instance);
  }

  mergeIntoEntity(entity, obj, callback?) {
    return tableEntity.merge(entity, obj, callback);
  }

  createEntity(partitionKey, rowKey, obj?, callback?) {
    return tableEntity.create(partitionKey, rowKey, obj, callback);
  }

  // basic settings interface
  // ------------------------
  getSetting(partitionKey, rowKey, callback) {
    getReducedEntity(this, this.options.settingsTableName, partitionKey, rowKey, callback);
  };

  setSetting(partitionKey, rowKey, value, callback) {
    const entity = this.createEntity(partitionKey, rowKey, value);
    this.table.insertEntity(this.options.settingsTableName, entity, callback);
  };

  deleteSetting(partitionKey, rowKey, callback) {
    this.table.deleteEntity(this.options.settingsTableName, this.createEntity(partitionKey, rowKey), callback);
  };

  replaceSetting(partitionKey, rowKey, mergeEntity, callback) {
    var dc = this;
    var entity = dc.createEntity(partitionKey, rowKey, mergeEntity);
    dc.table.replaceEntity(dc.options.settingsTableName, entity, callback);
  };

  getSettingByProperty(partitionKey, propertyName, value, callback) {
    const query = new azure.TableQuery().where(propertyName + ' eq ?', value);
    const self = this;
    self.table.queryEntities(self.options.settingsTableName,
      query,
      null,
      function (error, results) {
        if (error) return callback(error);
        const entries = [];
        if (results && results.entries && results.entries.length) {
          for (let i = 0; i < results.entries.length; i++) {
            entries.push(self.reduceEntity(results.entries[i]));
          }
        }
        callback(null, entries);
      });
  }

  // pending approvals workflow
  // --------------------------
  getPendingApprovals(teamsIn: string[], callback) {
    const ap = this.providers.approvalProvider;
    console.log('** getPendingApprovals **');
    ap.queryPendingApprovalsForTeams(teamsIn).then(entries => {
      return callback(null, entries);
    }).catch(error => {
      return callback(error);
    });
  };

  insertApprovalRequest(teamid, details, callback) {
    var dc = this;
    if (typeof teamid != 'string') {
      teamid = teamid.toString();
    }
    details.teamid = teamid;
    dc.insertGeneralApprovalRequest('joinTeam', details, callback);
  };

  insertGeneralApprovalRequest(ticketType, details, callback) {
    var dc = this;
    var id = uuidV4();
    var entity = dc.createEntity(dc.options.partitionKey, id, {
      tickettype: ticketType
    });
    dc.mergeIntoEntity(entity, details);
    dc.table.insertEntity(dc.options.pendingApprovalsTableName, entity, function (error, result, response) {
      if (error) {
        return callback(error);
      }
      // Pass back the generated request ID first.
      callback(null, id, result, response);
    });
  };

  getRepositoryApproval(fieldName, repositoryValue, callback) {
    const dc = this;
    // Shortcoming: repoName is case sensitive
    const query = new azure.TableQuery()
      .where('PartitionKey eq ?', this.options.partitionKey)
      .and('tickettype eq ?', 'repo')
      .and(`${fieldName} eq ?`, repositoryValue);
    dc.table.queryEntities(dc.options.pendingApprovalsTableName,
      query,
      null,
      function (error, results) {
        if (error) return callback(error);
        const entries = [];
        if (results && results.entries && results.entries.length) {
          for (let i = 0; i < results.entries.length; i++) {
            const r = results.entries[i];
            entries.push(dc.reduceEntity(r));
          }
        }
        callback(null, entries);
      });
  };

  getApprovalRequest(requestId: string, callback) {
    const ap = this.providers.approvalProvider;
    console.log('** getApprovalRequest **');
    ap.getApprovalEntity(requestId).then(entry => {
      return callback(null, entry);
    }).catch(error => {
      return callback(error);
    });
  };

  getPendingApprovalsForUserId(githubid: string, callback) {
    const ap = this.providers.approvalProvider;
    console.log('** getPendingApprovalsForUserId **');
    ap.queryPendingApprovalsForThirdPartyId(githubid).then(entries => {
      return callback(null, entries);
    }).catch(error => {
      return callback(error);
    });
  };

  replaceApprovalRequest(requestId, mergeEntity, callback) {
    var dc = this;
    var entity = dc.createEntity(dc.options.partitionKey, requestId, mergeEntity);
    dc.table.replaceEntity(dc.options.pendingApprovalsTableName, entity, callback);
  };

  updateApprovalRequest(requestId, mergeEntity, callback) {
    // This is a less efficient implementation for now due to encryption work.
    var dc = this;
    dc.getApprovalRequest(requestId, (getError, currentVersion) => {
      if (getError) {
        return callback(getError);
      }
      var newObject = {};
      Object.assign(newObject, currentVersion);
      Object.assign(newObject, mergeEntity);
      dc.replaceApprovalRequest(requestId, newObject, callback);
    });
  }
}

function getReducedEntity(dc, tableName, partitionKey, rowKey, callback) {
  dc.table.retrieveEntity(tableName, partitionKey, rowKey, function (error, ent) {
    if (error) return callback(error);
    callback(null, dc.reduceEntity(ent));
  });
}
