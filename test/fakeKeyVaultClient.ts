//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { v4 as uuidV4 } from 'uuid';
import { IDictionary } from '../interfaces';

let storedKeys = new Map();

function storeSecret(secretName: string, secretValue: string, tags: IDictionary<string>) {
  const version = uuidV4();
  const id = `https://fakekeyvault/secrets/${secretName}/${version}`;
  const secret = {
    id,
    value: secretValue,
    tags,
  };
  storedKeys.set(id, secret);
  return id;
}

function getSecret(vaultUri: string, secretId: string, secretVersion: string, callback) {
  const id = `https://fakekeyvault/secrets/${secretId}/${secretVersion}`;
  const val = storedKeys.get(id);
  if (val !== undefined) {
    return callback(null, val);
  }
  return callback(new Error('Secret not found.'));
}

export default () => {
  return {
    getSecret,
    storeSecret,
  };
};
