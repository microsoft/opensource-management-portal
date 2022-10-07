//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { Edm } from '@azure/data-tables';

function reduceEntity(instance: any): any {
  if (instance === undefined || instance === null) {
    return instance;
  }
  const newObject = {};
  for (let column in instance) {
    let value = instance[column];
    if (value?.type && value?.value) {
      value = value.value;
    }
    newObject[column] = value;
  }
  return newObject;
}

function createEntity(partitionKey: string, rowKey: string, obj?: any, callback?) {
  if (typeof obj === 'function') {
    callback = obj;
    obj = undefined;
  }
  var entity = {
    partitionKey,
    rowKey,
  };
  if (obj) {
    mergeIntoEntity(entity, obj, null);
  }
  if (callback) {
    return callback(null, entity);
  } else {
    return entity;
  }
}

function mergeIntoEntity(entity: any, obj: any, callback?) {
  // Pretty legacy code...
  if (obj) {
    for (let key in obj) {
      // Currently stripping metadata
      if (
        key === '.metadata' ||
        key === 'timestamp' ||
        key === 'etag' ||
        key === 'odata.metadata' ||
        key === 'partitionKey' ||
        key === 'rowKey'
      ) {
        continue;
      }
      if (obj[key] === undefined || obj[key] === null) {
        // Skip undefined/null objects, including the key
        continue;
      }
      const value = obj[key];
      if (typeof value === 'string') {
        entity[key] = { type: 'String', value: obj[key] } as Edm<'String'>;
      } else if (value === true || value === false) {
        entity[key] = { type: 'Boolean', value } as Edm<'Boolean'>;
      } else if (Buffer.isBuffer(value)) {
        const asBuffer = value as Buffer;
        entity[key] = { type: 'Binary', value: asBuffer.buffer } as Edm<'Binary'>;
      } else if (value instanceof Date) {
        const asDate = value as Date;
        entity[key] = { type: 'DateTime', value: asDate.toISOString() } as Edm<'DateTime'>;
      } else if (typeof obj[key] === 'number') {
        // Opinionated entity processing: store all numbers as strings
        entity[key] = { type: 'String', value: String(value) } as Edm<'String'>;
      } else {
        console.warn(
          'Consider whether a new entity merge clause is required for key ' + key + ' of type:' + typeof value
        );
        if (value?.toString) {
          entity[key] = { type: 'String', value: value.toString() } as Edm<'String'>;
        } else {
          entity[key] = { type: 'String', value: String(value) } as Edm<'String'>;
        }
      }
    }
  }
  if (callback) {
    callback(null, entity);
  } else {
    return entity;
  }
}

export default {
  reduce: reduceEntity,
  create: createEntity,
  merge: mergeIntoEntity,
};
