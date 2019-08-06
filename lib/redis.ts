//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import redis = require('redis');
import Q from 'q';

const debug = require('debug')('oss-redis');
const debugCrossOrganization = require('debug')('oss-redis-cross-org');

const zlib = require('zlib');

const compressionOptions = {
  type: 'gzip',
  params: {
    level: zlib.Z_BEST_SPEED,
  },
};

function objectFromJson(json, callback) {
  var error = null;
  var object = null;
  try {
    if (json) {
      object = JSON.parse(json);
    }
  } catch (ex) {
    error = ex;
    object = null;
  }
  callback(error, object);
}

function objectToJson(object, callback) {
  var error = null;
  var json = null;
  try {
    json = JSON.stringify(object);
  } catch (ex) {
    error = ex;
  }
  callback(error, json);
}

export class RedisHelper {
  private redis: redis.RedisClient;
  private prefix: string;

  constructor(redisClient: redis.RedisClient, prefix?: string) {
    this.redis = redisClient;
    this.prefix = prefix ? prefix + '.' : '';
  }

  getSet(key: string, callback) {
    const k = this.prefix + key;
    this.redis.smembers(k, callback);
  }

  addSetMember(key: string, member, callback) {
    const k = this.prefix + key;
    this.redis.sadd(k, member, callback);
  }

  removeSetMember(key: string, member, callback) {
    const k = this.prefix + key;
    this.redis.srem(k, member, callback);
  }

  get(key: string, callback) {
    const k = this.prefix + key;
    debug('GET ' + k);
    if (k.includes('.x#')) {
      debugCrossOrganization('    GET ' + k);
    }
    this.redis.get(k, callback);
  }

  getCompressed(key: string, callback) {
    const k = this.prefix + key;
    debug('GET ' + k);
    if (k.includes('.x#')) {
      debugCrossOrganization('    GET ' + k);
    }
    const bufferKey = Buffer.from(k);
    this.redis.get(bufferKey as any as string /* Buffer key type to make TypeScript happy */, (error, buffer) => {
      if (error) {
        return process.nextTick(callback, error);
      }
      if (buffer === undefined || buffer === null) {
        return process.nextTick(callback, null, buffer);
      }
      zlib.gunzip(buffer, (unzipError, unzipped) => {
        // Fallback if there is a data error (i.e. it's not compressed)
        if (unzipError && unzipError.errno === zlib.Z_DATA_ERROR) {
          const originalValue = buffer.toString();
          return process.nextTick(callback, null, originalValue);
        } else if (unzipError) {
          return process.nextTick(callback, unzipError);
        }
        const unzippedValue = unzipped.toString();
        return process.nextTick(callback, null, unzippedValue);
      });
    });
  }

  set(key: string, value, callback) {
    const k = this.prefix + key;
    debug('SET ' + k);
    this.redis.set(k, value, callback);
  }

  setCompressed(key: string, value, options, callback) {
    if (!callback && typeof(options) === 'function') {
      callback = options;
      options = null;
    }
    options = options || {};
    const minutesToExpire = options.minutesToExpire || null;
    const k = this.prefix + key;
    if (minutesToExpire) {
      debug('SET ' + k + ' EX ' + minutesToExpire + 'm');
    } else {
      debug('SET ' + k);
    }
    const val = Buffer.from(value);
    zlib.gzip(val, compressionOptions, (gzipError, compressed) => {
      if (gzipError) {
        return callback(gzipError);
      }
      const bufferKey = Buffer.from(k);
      if (minutesToExpire) {
        this.redis.set(bufferKey as any as string /* Buffer key type to make TypeScript happy */, compressed, 'EX', minutesToExpire * 60, callback);
      } else {
        this.redis.set(bufferKey as any as string /* Buffer key type to make TypeScript happy */, compressed, callback);
      }
    });
  }

  delete(key: string, callback) {
    const k = this.prefix + key;
    debug('DEL ' + k);
    this.redis.del(k, callback);
  }

  setWithExpire(key: string, value, minutesToExpire, callback) {
    if (!minutesToExpire) {
      return callback(new Error('No minutes to expiration provided.'));
    }
    const k = this.prefix + key;
    debug('SET ' + k + ' EX ' + minutesToExpire + 'm');
    this.redis.set(k, value, 'EX', minutesToExpire * 60, callback);
  }

  setCompressedWithExpire(key: string, value, minutesToExpire, callback) {
    if (!minutesToExpire) {
      return callback(new Error('No minutes to expiration provided.'));
    }
    const options = {
      minutesToExpire: minutesToExpire,
    };
    return this.setCompressed(key, value, options, callback);
  }

  expire(key: string, minutesToExpire, callback) {
    if (!minutesToExpire) {
      return callback(new Error('No minutes to expiration provided.'));
    }
    const k = this.prefix + key;
    // debug('EXP ' + k + ' ' + minutesToExpire + 'm');
    this.redis.expire(k, minutesToExpire * 60, callback);
  }

  // Helper versions for object/json conversions

  getObject(key: string, callback) {
    this.get(key, function (error, json) {
      if (error) {
        return callback(error);
      }
      objectFromJson(json, callback);
    });
  }

  getObjectCompressed(key: string, callback) {
    this.getCompressed(key, function (error, json) {
      if (error) {
        return callback(error);
      }
      objectFromJson(json, callback);
    });
  }

  setObject(key: string, value, callback) {
    var self = this;
    objectToJson(value, function (error, json) {
      if (!error) {
        self.set(key, json, callback);
      } else {
        callback(error);
      }
    });
  }

  setObjectWithExpire(key: string, value, minutesToExpire, callback) {
    var self = this;
    objectToJson(value, function (error, json) {
      if (!error) {
        self.setWithExpire(key, json, minutesToExpire, callback);
      } else {
        callback(error);
      }
    });
  }

  setObjectCompressedWithExpire(key: string, value, minutesToExpire, callback) {
    const self = this;
    objectToJson(value, function (error, json) {
      if (!error) {
        self.setCompressedWithExpire(key, json, minutesToExpire, callback);
      } else {
        callback(error);
      }
    });
  }

  getAsync(key: string) {
    return Q.ninvoke(this, 'get', key);
  }

  getCompressedAsync(key: string) {
    return Q.ninvoke(this, 'getCompressed', key);
  }

  getObjectAsync(key: string) {
    return Q.ninvoke(this, 'getObject', key);
  }

  getObjectCompressedAsync(key: string) {
    return Q.ninvoke(this, 'getObjectCompressed', key);
  }

  setAsync(key: string, value) {
    return Q.ninvoke(this, 'set', key, value);
  }

  setObjectAsync(key: string, value) {
    return Q.ninvoke(this, 'setObject', key, value);
  }

  setObjectWithExpireAsync(key: string, value, minutesToExpire) {
    return Q.ninvoke(this, 'setObjectWithExpire', key, value, minutesToExpire);
  }

  setObjectCompressedWithExpireAsync(key: string, value, minutesToExpire) {
    return Q.ninvoke(this, 'setObjectCompressedWithExpire', key, value, minutesToExpire);
  }

  setCompressedWithExpireAsync(key: string, value, minutesToExpire) {
    return Q.ninvoke(this, 'setCompressedWithExpire', key, value, minutesToExpire);
  }

  setWithExpireAsync(key: string, value, minutesToExpire) {
    return Q.ninvoke(this, 'setWithExpire', key, value, minutesToExpire);
  }

  expireAsync(key: string, minutesToExpire) {
    return Q.ninvoke(this, 'expire', key, minutesToExpire);
  }

  deleteAsync(key: string) {
    return Q.ninvoke(this, 'delete', key);
  }
}
