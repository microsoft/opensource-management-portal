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
// Session utility: Store the referral URL, if present, and redirect to a new
// location.
// ----------------------------------------------------------------------------
exports.storeReferrer = function storeReferrer(req, res, redirect, optionalReason) {
  const eventDetails = {
    method: 'storeReferrer',
    reason: optionalReason || 'unknown reason',
  };
  if (req.session && req.headers && req.headers.referer && req.session.referer !== undefined && !req.headers.referer.includes('/signout')) {
    req.session.referer = req.headers.referer;
    eventDetails.referer = req.headers.referer;
  }
  if (redirect) {
    eventDetails.redirect = redirect;
    if (req.insights) {
      req.insights.trackEvent('RedirectWithReferrer', eventDetails);
    }
    res.redirect(redirect);
  }
};

// ----------------------------------------------------------------------------
// Session utility: store the original URL
// ----------------------------------------------------------------------------
exports.storeOriginalUrlAsReferrer = function storeOriginalUrl(req, res, redirect, optionalReason) {
  storeOriginalUrlAsVariable(req, res, 'referer', redirect, optionalReason);
};

exports.redirectToReferrer = function redirectToReferrer(req, res, url, optionalReason) {
  url = url || '/';
  const alternateUrl = popSessionVariable(req, res, 'referer');
  const eventDetails = {
    method: 'redirectToReferrer',
    reason: optionalReason || 'unknown reason',
  };
  if (req.insights) {
    req.insights.trackEvent('RedirectToReferrer', eventDetails);
  }
  res.redirect(alternateUrl || url);
};

function storeOriginalUrlAsVariable(req, res, variable, redirect, optionalReason) {
  const eventDetails = {
    method: 'storeOriginalUrlAsVariable',
    variable: variable,
    redirect: redirect,
    reason: optionalReason || 'unknown reason',
  };
  if (req.session && req.originalUrl) {
    req.session[variable] = req.originalUrl;
  }
  if (redirect) {
    if (req.insights) {
      req.insights.trackEvent('RedirectFromOriginalUrl', eventDetails);
    }
    res.redirect(redirect);
  }
}

exports.storeOriginalUrlAsVariable = storeOriginalUrlAsVariable;

function popSessionVariable(req, res, variableName) {
  if (req.session && req.session[variableName] !== undefined) {
    const url = req.session[variableName];
    delete req.session[variableName];
    return url;
  }
}

exports.popSessionVariable = popSessionVariable;

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
// A destructive removal function for an object. Removes a single key.
// ----------------------------------------------------------------------------
exports.stealValue = function steal(obj, key) {
  if (obj[key] !== undefined) {
    var val = obj[key];
    delete obj[key];
    return val;
  }
};

// ----------------------------------------------------------------------------
// Given a list of string values, check a string, using a case-insensitive
// comparison.
// ----------------------------------------------------------------------------
exports.inListInsensitive = function inListInsensitive(list, value) {
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
exports.isInListAnycaseInLowercaseList = function isInListAnycaseInLowercaseList(list, value) {
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
exports.arrayToHashById = function arrayToHashById(inputArray) {
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
  lastCharactersShowCount = Math.min(Math.round(lastCharactersShowCount), length - 1);
  var obfuscated = '';
  for (var i = 0; i < length - lastCharactersShowCount; i++) {
    obfuscated += '*';
  }
  for (var j = length - lastCharactersShowCount; j < length; j++) {
    obfuscated += value[j];
  }
  return obfuscated;
};

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

exports.stackSafeCallback = function stackSafeCallback(callback, err, item, extraItem) {
  // Works around RangeError: Maximum call stack size exceeded.
  async.setImmediate(() => {
    callback(err, item, extraItem);
  });
};

exports.createSafeCallbackNoParams = function createSafeCallbackNoParams(cb) {
  return () => {
    exports.stackSafeCallback(cb);
  };
};
