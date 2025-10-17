//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import _ from 'lodash';

import { PromiseResolve, PromiseReject, ICallback } from '../interfaces/index.js';

export function assignKnownFieldsPrefixed(
  self,
  entity,
  type,
  primaryProperties,
  secondaryProperties?,
  prefix?: string
) {
  prefix = prefix || '_';
  const copy = Object.assign({}, entity);

  const directSet = _.pick(copy, primaryProperties);
  _.keys(directSet).forEach((key) => {
    delete copy[key];
  });
  for (const [key, value] of Object.entries(directSet)) {
    self[`${prefix}${key}`] = value;
  }

  if (secondaryProperties) {
    const otherSet = _.pick(copy, secondaryProperties);
    _.keys(otherSet).forEach((key) => {
      delete copy[key];
    });
    const otherFieldsKeyName = 'otherFields';
    if (!self[otherFieldsKeyName]) {
      self[otherFieldsKeyName] = {};
    }
    Object.assign(self[otherFieldsKeyName], otherSet);
  }

  const remainingKeys = _.keys(copy);
  if (remainingKeys.length > 0) {
    const extraFieldsKeyName = 'extraFields';
    if (!self[extraFieldsKeyName]) {
      self[extraFieldsKeyName] = {};
    }
    remainingKeys.forEach((key) => {
      self[extraFieldsKeyName][key] = copy[key];
    });
  }
}

export function createInstances<T>(self, createMethod, entities: T[]): T[] {
  const wrap = createMethod.bind(self);
  return _.map(entities, wrap) as any as T[];
}
