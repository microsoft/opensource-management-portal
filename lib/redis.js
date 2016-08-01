//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

const debug = require('debug')('oss-redis');

function RedisHelper(ossInstance, prefix) {
  this.oss = ossInstance;
  this.redis = ossInstance.redisClient();
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
  // debug('GET ' + k);
  this.redis.get(k, callback);
};

RedisHelper.prototype.set = function (key, value, callback) {
  var k = this.prefix + key;
  debug('SET ' + k);
  this.redis.set(k, value, callback);
};


RedisHelper.prototype.delete = function (key, callback) {
  var k = this.prefix + key;
  debug('DEL ' + k);
  this.redis.del(k, callback);
};

RedisHelper.prototype.setWithExpire = function (key, value, minutesToExpire, callback) {
  var k = this.prefix + key;
  debug('SET ' + k + ' EX ' + minutesToExpire + 'm');
  this.redis.set(k, value, 'EX', minutesToExpire * 60, callback);
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

module.exports = RedisHelper;
