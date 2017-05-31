//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

const debug = require('debug')('oss-redis');
const debugCrossOrganization = require('debug')('oss-redis-cross-org');
const Q = require('q');
const zlib = require('zlib');

const compressionOptions = {
  type: 'gzip',
  params: {
    level: zlib.Z_BEST_SPEED,
  },
};

function RedisHelper(redisClient, prefix) {
  this.redis = redisClient;
  this.prefix = prefix ? prefix + '.' : '';
}

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

RedisHelper.prototype.getSet = function (key, callback) {
  var k = this.prefix + key;
  this.redis.smembers(k, callback);
};

RedisHelper.prototype.addSetMember = function (key, member, callback) {
  var k = this.prefix + key;
  this.redis.sadd(k, member, callback);
};

RedisHelper.prototype.removeSetMember = function (key, member, callback) {
  var k = this.prefix + key;
  this.redis.srem(k, member, callback);
};

RedisHelper.prototype.get = function (key, callback) {
  var k = this.prefix + key;
  debug('GET ' + k);
  if (k.includes('.x#')) {
    debugCrossOrganization('    GET ' + k);
  }
  this.redis.get(k, callback);
};

RedisHelper.prototype.getCompressed = function (key, callback) {
  var k = this.prefix + key;
  debug('GET ' + k);
  if (k.includes('.x#')) {
    debugCrossOrganization('    GET ' + k);
  }
  const bufferKey = new Buffer(k);
  this.redis.get(bufferKey, (error, buffer) => {
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
};

RedisHelper.prototype.set = function (key, value, callback) {
  var k = this.prefix + key;
  debug('SET ' + k);
  this.redis.set(k, value, callback);
};

RedisHelper.prototype.setCompressed = function (key, value, options, callback) {
  if (!callback && typeof(options) === 'function') {
    callback = options;
    options = null;
  }
  options = options || {};
  const minutesToExpire = options.minutesToExpire || null;
  var k = this.prefix + key;
  if (minutesToExpire) {
    debug('SET ' + k + ' EX ' + minutesToExpire + 'm');
  } else {
    debug('SET ' + k);
  }
  const val = new Buffer(value);
  zlib.gzip(val, compressionOptions, (gzipError, compressed) => {
    if (gzipError) {
      return callback(gzipError);
    }
    const bufferKey = new Buffer(k);
    if (minutesToExpire) {
      this.redis.set(bufferKey, compressed, 'EX', minutesToExpire * 60, callback);
    } else {
      this.redis.set(bufferKey, compressed, callback);
    }
  });
};

RedisHelper.prototype.delete = function (key, callback) {
  var k = this.prefix + key;
  debug('DEL ' + k);
  this.redis.del(k, callback);
};

RedisHelper.prototype.setWithExpire = function (key, value, minutesToExpire, callback) {
  if (!minutesToExpire) {
    return callback(new Error('No minutes to expiration provided.'));
  }
  var k = this.prefix + key;
  debug('SET ' + k + ' EX ' + minutesToExpire + 'm');
  this.redis.set(k, value, 'EX', minutesToExpire * 60, callback);
};

RedisHelper.prototype.setCompressedWithExpire = function (key, value, minutesToExpire, callback) {
  if (!minutesToExpire) {
    return callback(new Error('No minutes to expiration provided.'));
  }
  const options = {
    minutesToExpire: minutesToExpire,
  };
  return this.setCompressed(key, value, options, callback);
};

RedisHelper.prototype.expire = function (key, minutesToExpire, callback) {
  if (!minutesToExpire) {
    return callback(new Error('No minutes to expiration provided.'));
  }
  var k = this.prefix + key;
  // debug('EXP ' + k + ' ' + minutesToExpire + 'm');
  this.redis.expire(k, minutesToExpire * 60, callback);
};

// Helper versions for object/json conversions

RedisHelper.prototype.getObject = function (key, callback) {
  this.get(key, function (error, json) {
    if (error) {
      return callback(error);
    }
    objectFromJson(json, callback);
  });
};

RedisHelper.prototype.getObjectCompressed = function (key, callback) {
  this.getCompressed(key, function (error, json) {
    if (error) {
      return callback(error);
    }
    objectFromJson(json, callback);
  });
};

RedisHelper.prototype.setObject = function (key, value, callback) {
  var self = this;
  objectToJson(value, function (error, json) {
    if (!error) {
      self.set(key, json, callback);
    } else {
      callback(error);
    }
  });
};

RedisHelper.prototype.setObjectWithExpire = function (key, value, minutesToExpire, callback) {
  var self = this;
  objectToJson(value, function (error, json) {
    if (!error) {
      self.setWithExpire(key, json, minutesToExpire, callback);
    } else {
      callback(error);
    }
  });
};

RedisHelper.prototype.setObjectCompressedWithExpire = function (key, value, minutesToExpire, callback) {
  const self = this;
  objectToJson(value, function (error, json) {
    if (!error) {
      self.setCompressedWithExpire(key, json, minutesToExpire, callback);
    } else {
      callback(error);
    }
  });
};

RedisHelper.prototype.getAsync = function (key) {
  return Q.ninvoke(this, 'get', key);
};

RedisHelper.prototype.getCompressedAsync = function (key) {
  return Q.ninvoke(this, 'getCompressed', key);
};

RedisHelper.prototype.getObjectAsync = function (key) {
  return Q.ninvoke(this, 'getObject', key);
};

RedisHelper.prototype.getObjectCompressedAsync = function (key) {
  return Q.ninvoke(this, 'getObjectCompressed', key);
};

RedisHelper.prototype.setAsync = function (key, value) {
  return Q.ninvoke(this, 'set', key, value);
};

RedisHelper.prototype.setObjectAsync = function (key, value) {
  return Q.ninvoke(this, 'setObject', key, value);
};

RedisHelper.prototype.setObjectWithExpireAsync = function (key, value, minutesToExpire) {
  return Q.ninvoke(this, 'setObjectWithExpire', key, value, minutesToExpire);
};

RedisHelper.prototype.setObjectCompressedWithExpireAsync = function (key, value, minutesToExpire) {
  return Q.ninvoke(this, 'setObjectCompressedWithExpire', key, value, minutesToExpire);
};

RedisHelper.prototype.setCompressedWithExpireAsync = function (key, value, minutesToExpire) {
  return Q.ninvoke(this, 'setCompressedWithExpire', key, value, minutesToExpire);
};

RedisHelper.prototype.setWithExpireAsync = function (key, value, minutesToExpire) {
  return Q.ninvoke(this, 'setWithExpire', key, value, minutesToExpire);
};

RedisHelper.prototype.expireAsync = function (key, minutesToExpire) {
  return Q.ninvoke(this, 'expire', key, minutesToExpire);
};

RedisHelper.prototype.deleteAsync = function (key) {
  return Q.ninvoke(this, 'delete', key);
};

module.exports = RedisHelper;
