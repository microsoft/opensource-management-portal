//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

const async = require('async');

// ----------------------------------------------------------------------------
// Returns an integer, random, between low and high (exclusive) - [low, high)
// ----------------------------------------------------------------------------
exports.randomInteger = function (low, high) {
  return Math.floor(Math.random() * (high - low) + low);
};

// ----------------------------------------------------------------------------
// Provide our own error wrapper and message for an underlying thrown error.
// Useful for the user-presentable version.
// ----------------------------------------------------------------------------
exports.wrapError = function (error, message, userIntendedMessage) {
  var err = new Error(message);
  err.innerError = error;
  if (error && error.stack) {
    err.stack = error.stack;
  }
  if (userIntendedMessage === true) {
    err.skipLog = true;
  }
  return err;
};

// ----------------------------------------------------------------------------
// Split and set an optional array, or empty array, trimming each.
// ----------------------------------------------------------------------------
exports.arrayFromString = function (a, split) {
  if (!split) {
    split = ',';
  }
  var b = a && a.split ? a.split(split) : [];
  if (b && b.length) {
    for (var i = 0; i < b.length; i++) {
      b[i] = b[i].trim();
    }
  }
  return b;
};

// ----------------------------------------------------------------------------
// Simplistic merge of setting properties from b on object a.
// ----------------------------------------------------------------------------
exports.merge = function (a, b) {
  if (a && b) {
    for (var key in b) {
      a[key] = b[key];
    }
  }
  return a;
};


// ----------------------------------------------------------------------------
// Improved "Is Array" check.
// ----------------------------------------------------------------------------
exports.isArray = function (value) {
  return value && typeof value === 'object' && value.constructor === Array;
};

// ----------------------------------------------------------------------------
// Retrieves all pages of a GitHub (octonode) API endpoint by following the
// next link, if present, in results. Each page is of max GitHub-allowed size,
// 100 items. Keep in mind that each page is 1 API call from the API allownace.
// ----------------------------------------------------------------------------
exports.retrieveAllPages = function retrieveAllPages(method, optionalFilter, callback) {
  if (typeof optionalFilter == 'function') {
    callback = optionalFilter;
    optionalFilter = null;
  }
  var done = false;
  var page = 1;
  var results = [];
  async.whilst(
    function () { return !done; },
    function (cb) {
      var params = {
        page: page++,
        per_page: 100,
      };
      if (optionalFilter) {
        exports.merge(params, optionalFilter);
      }
      method.call(null, params, function (error, result, headers) {
        if (error) {
          done = true;
        } else {
          if (result && result.length) {
            results = results.concat(result);
          }
          done = !(headers && headers.link && headers.link.indexOf('rel="next"') >= 0);
        }
        cb(error);
      });
    },
    function (error) {
      callback(error, error ? undefined : results);
    });
};

// ----------------------------------------------------------------------------
// A destructive removal function for an object. Removes a single key.
// ----------------------------------------------------------------------------
exports.stealValue = function steal(obj, key) {
  if (obj[key] !== undefined) {
    var val = obj[key];
    delete obj[key];
    return val;
  } else {
    return undefined;
  }
};

// ----------------------------------------------------------------------------
// Given a list of string values, check a string, using a case-insensitive
// comparison.
// ----------------------------------------------------------------------------
exports.inListInsensitive = function ili(list, value) {
  value = value.toLowerCase();
  for (var i = 0; i < list.length; i++) {
    if (list[i].toLowerCase() === value) {
      return true;
    }
  }
  return false;
};

// ----------------------------------------------------------------------------
// Given a list of lowercase values, check whether a value is present.
// ----------------------------------------------------------------------------
exports.isInListAnycaseInLowercaseList = function iila(list, value) {
  value = value.toLowerCase();
  for (var i = 0; i < list.length; i++) {
    if (list[i] === value) {
      return true;
    }
  }
  return false;
};

// ----------------------------------------------------------------------------
// Given an array of things that have an `id` property, return a hash indexed
// by that ID.
// ----------------------------------------------------------------------------
exports.arrayToHashById = function athi(inputArray) {
  var hash = {};
  if (inputArray && inputArray.length) {
    for (var i = 0; i < inputArray.length; i++) {
      if (inputArray[i] && inputArray[i].id) {
        hash[inputArray[i].id] = inputArray[i];
      }
    }
  }
  return hash;
};

// ----------------------------------------------------------------------------
// Obfuscate a string value, optionally leaving a few characters visible.
// ----------------------------------------------------------------------------
exports.obfuscate = function obfuscate(value, lastCharactersShowCount) {
  if (value === undefined || value === null || value.length === undefined) {
    return value;
  }
  var length = value.length;
  lastCharactersShowCount = lastCharactersShowCount || 0;
  lastCharactersShowCount = Math.min(lastCharactersShowCount, length - 1);
  var obfuscated = '';
  for (var i = 0; i < length - lastCharactersShowCount; i++) {
    obfuscated += '*';
  }
  for (var j = length - lastCharactersShowCount; j < length; j++) {
    obfuscated += value[j];
  }
  return obfuscated;
}

// ----------------------------------------------------------------------------
// A very basic breadcrumb stack that ties in to an Express request object.
// ----------------------------------------------------------------------------
exports.addBreadcrumb = function (req, breadcrumbTitle, optionalBreadcrumbLink) {
  if (req === undefined || req.baseUrl === undefined) {
    throw new Error('addBreadcrumb: did you forget to provide a request object instance?');
  }
  if (!optionalBreadcrumbLink && optionalBreadcrumbLink !== false) {
    optionalBreadcrumbLink = req.baseUrl;
  }
  if (!optionalBreadcrumbLink && optionalBreadcrumbLink !== false) {
    optionalBreadcrumbLink = '/';
  }
  var breadcrumbs = req.breadcrumbs;
  if (breadcrumbs === undefined) {
    breadcrumbs = [];
  }
  breadcrumbs.push({
    title: breadcrumbTitle,
    url: optionalBreadcrumbLink,
  });
  req.breadcrumbs = breadcrumbs;
};
