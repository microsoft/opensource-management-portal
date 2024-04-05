//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { RedisClientType, commandOptions } from 'redis';
import zlib from 'zlib';

import Debug from 'debug';
const debug = Debug.debug('redis');
const debugCrossOrganization = Debug.debug('redis-cross-org');

import type { ICacheHelper } from '.';
import { gunzipBuffer, gzipString } from '../utils';

export interface ISetCompressedOptions {
  minutesToExpire?: number;
}

export interface IRedisHelperOptions {
  redisClient: RedisClientType;
  prefix?: string;
}

export default class RedisHelper implements ICacheHelper {
  private _redis: RedisClientType;
  private _prefix: string;

  constructor(options: IRedisHelperOptions) {
    if (!options.redisClient) {
      throw new Error('options.redisClient required by RedisHelper');
    }
    this._prefix = options.prefix ? options.prefix + '.' : '';
    this._redis = options.redisClient;
  }

  private key(key: string) {
    return this._prefix + key;
  }

  get(key: string): Promise<string> {
    key = this.key(key);
    debug('GET ' + key);
    if (key.includes('.x#')) {
      debugCrossOrganization('    GET ' + key);
    }
    return this._redis.get(key);
  }

  async getCompressed(key: string): Promise<string> {
    key = this.key(key);
    debug('GET ' + key);
    if (key.includes('.x#')) {
      debugCrossOrganization('    GET ' + key);
    }
    const bufferOptions = commandOptions({ returnBuffers: true });
    const buffer = await this._redis.get(bufferOptions, key);
    if (buffer === undefined || buffer === null) {
      return null;
    }
    try {
      const unzipped = await gunzipBuffer(buffer);
      return unzipped;
    } catch (unzipError) {
      if ((unzipError as any)?.errno === zlib.constants.Z_DATA_ERROR) {
        const originalValue = buffer.toString();
        return originalValue;
      } else if (unzipError) {
        throw unzipError;
      }
    }
  }

  async setCompressed(key: string, value: string, options?: ISetCompressedOptions): Promise<void> {
    key = this.key(key);
    const minutesToExpire = options ? options.minutesToExpire : null;
    if (minutesToExpire) {
      debug(`SET ${key} EX ${minutesToExpire}m`);
    } else {
      debug(`SET ${key}`);
    }
    const compressed = await gzipString(value);
    if (minutesToExpire) {
      await this._redis.setEx(key, minutesToExpire * 60, compressed);
    } else {
      await this._redis.set(key, compressed);
    }
  }

  async getObject(key: string): Promise<any> {
    const value = await this.get(key);
    return JSON.parse(value);
  }

  async getObjectCompressed(key: string): Promise<any> {
    const value = await this.getCompressed(key);
    return JSON.parse(value);
  }

  setObject(key: string, object: any): Promise<void> {
    const json = JSON.stringify(object);
    return this.set(key, json);
  }

  async set(key: string, value: string): Promise<void> {
    key = this.key(key);
    debug('SET ' + key);
    await this._redis.set(key, value);
  }

  setObjectWithExpire(key: string, object: any, minutesToExpire: number): Promise<void> {
    const json = JSON.stringify(object);
    return this.setWithExpire(key, json, minutesToExpire);
  }

  setObjectCompressedWithExpire(key: string, object: any, minutesToExpire: number): Promise<void> {
    const json = JSON.stringify(object);
    return this.setCompressedWithExpire(key, json, minutesToExpire);
  }

  setCompressedWithExpire(key: string, value: string, minutesToExpire: number): Promise<void> {
    if (!minutesToExpire) {
      throw new Error('No minutes to expiration value');
    }
    const options = { minutesToExpire };
    return this.setCompressed(key, value, options);
  }

  async setWithExpire(key: string, value: string, minutesToExpire: number): Promise<void> {
    if (!minutesToExpire) {
      throw new Error('No minutes to expiration value');
    }
    key = this.key(key);
    debug(`SET ${key} EX ${minutesToExpire}m`);
    await this._redis.setEx(key, minutesToExpire * 60, value);
  }

  async expire(key: string, minutesToExpire: number): Promise<void> {
    if (!minutesToExpire) {
      throw new Error('No minutes to expiration value');
    }
    key = this.key(key);
    debug(`EXP ${key}`);
    await this._redis.expire(key, minutesToExpire * 60);
  }

  async delete(key: string): Promise<void> {
    key = this.key(key);
    debug('DEL ' + key);
    await this._redis.del(key);
  }
}
