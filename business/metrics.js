//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

const async = require('async');
const azure = require('azure-storage');

function retrieveFromAzureTable(config, type, id, callback) {
  const tableService = azure.createTableService(config.account, config.key);
  let metrics = [];
  let done = false;
  let continuationToken = null;
  async.whilst(
    function areWeDone() { return !done; },
    function grabPage(cb) {
      const query = new azure.TableQuery().where('PartitionKey eq ?', type);
      if (id) {
        query.and('RowKey eq ?', id);
      }
      tableService.queryEntities(config.tableName, query, continuationToken, (error, results) => {
        if (error) {
          done = true;
          return cb(error);
        }
        if (results.continuationToken) {
          continuationToken = results.continuationToken;
        } else {
          done = true;
        }
        if (results && results.entries) {
          results.entries.forEach(entry => {
            metrics.push(reduceEntity(entry));
          });
        }
        cb();
      });
    }, function (queryingError) {
      return callback(queryingError, metrics);
    });
}

function reduceEntity(instance) {
  if (!instance) {
    return instance;
  }
  for (let column in instance) {
    if (instance[column]) {
      instance[column] = instance[column]._;
    }
  }
  return instance;
}

module.exports.retrieveFromAzureTable = retrieveFromAzureTable;
