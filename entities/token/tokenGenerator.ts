//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import crypto from 'crypto';

export interface IGeneratedToken {
  key: string;
  token: string;
}

export class TokenGenerator {
  public static Generate(): IGeneratedToken {
    const key = crypto.randomBytes(32).toString('base64');
    const token = crypto.createHash('sha1').update(key).digest('hex');
    return { key, token };
  }
}
