//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

import { TableLinkProvider } from './tableLinkProvider';

module.exports = function createProvider(providers, config) {
  let tableOptions = config && config.github && config.github.links ? config.github.links.table : null;
  if (!tableOptions) {
    throw new Error('TableLinkProvider requires config.github.links.table');
  }

  const keyEncryptionKeyResolver = providers.keyEncryptionKeyResolver;

  const modernTableOptions = Object.assign({}, tableOptions);
  modernTableOptions.encryption = {
    encryptionKeyId: tableOptions.encryptionKeyId,
    keyEncryptionKeyResolver: keyEncryptionKeyResolver,
  };

  const originalTablePrefix = config.github.links.table.prefix || '';
  const originalTablePartitionKey = originalTablePrefix + 'pk';
  const originalTableName = originalTablePrefix + 'links';

  modernTableOptions.tableName = originalTableName; // 'jeffv7test';
  modernTableOptions.partitionKey = originalTablePartitionKey; // 'testing';

  return new TableLinkProvider(providers, modernTableOptions);
};
