//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import async = require('async');
import fs = require('fs');
import path = require('path');

import { URL } from 'url';

import { IReposError } from './transitional';

export function requireJson(nameFromRoot: string): any {
  // In some situations TypeScript can load from JSON, but for the transition this is better to reach outside the out directory
  let file = path.resolve(__dirname, nameFromRoot);
  // If within the output directory
  if (fs.existsSync(file)) {
    const content = fs.readFileSync(file, 'utf8');
    return JSON.parse(content);
  }
  file = path.resolve(__dirname, '..', nameFromRoot);
  if (!fs.existsSync(file)) {
    throw new Error(`Cannot find JSON file ${file} to read as a module`);
  }
  const content = fs.readFileSync(file, 'utf8');
  console.warn(`JSON as module (${file}) from project root (NOT TypeScript 'dist' folder)`);
  return JSON.parse(content);
}

// ----------------------------------------------------------------------------
// Returns an integer, random, between low and high (exclusive) - [low, high)
// ----------------------------------------------------------------------------
export function randomInteger(low, high) {
  return Math.floor(Math.random() * (high - low) + low);
};

export function safeLocalRedirectUrl(path: string) {
  if (!path) {
    return;
  }
  const url = new URL(path, 'http://localhost');
  if (url.host !== 'localhost') {
    return;
  }
  return url.search ? `${url.pathname}${url.search}` : url.pathname;
}

// ----------------------------------------------------------------------------
// Session utility: Store the referral URL, if present, and redirect to a new
// location.
// ----------------------------------------------------------------------------
interface IStoreReferrerEventDetails {
  method: string;
  reason: string;
  referer?: string;
  redirect?: string;
}

export function storeReferrer(req, res, redirect, optionalReason) {
  const eventDetails : IStoreReferrerEventDetails = {
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
      req.insights.trackEvent({ name: 'RedirectWithReferrer', properties: eventDetails });
    }
    res.redirect(redirect);
  }
};

// ----------------------------------------------------------------------------
// Session utility: store the original URL
// ----------------------------------------------------------------------------
export function storeOriginalUrlAsReferrer(req, res, redirect, optionalReason) {
  storeOriginalUrlAsVariable(req, res, 'referer', redirect, optionalReason);
};

export function redirectToReferrer(req, res, url, optionalReason) {
  url = url || '/';
  const alternateUrl = popSessionVariable(req, res, 'referer');
  const eventDetails = {
    method: 'redirectToReferrer',
    reason: optionalReason || 'unknown reason',
  };
  if (req.insights) {
    req.insights.trackEvent({ name: 'RedirectToReferrer', properties: eventDetails });
  }
  res.redirect(alternateUrl || url);
};

export function storeOriginalUrlAsVariable(req, res, variable, redirect, optionalReason) {
  const eventDetails = {
    method: 'storeOriginalUrlAsVariable',
    variable: variable,
    redirect: redirect,
    reason: optionalReason || 'unknown reason',
  };
  if (req.session && req.originalUrl) {
    req.session[variable] = req.originalUrl;
    eventDetails['ou'] = req.originalUrl;
  }
  if (redirect) {
    if (req.insights) {
      req.insights.trackEvent({ name: 'RedirectFromOriginalUrl', properties: eventDetails });
    }
    res.redirect(redirect);
  }
}

export function popSessionVariable(req, res, variableName) {
  if (req.session && req.session[variableName] !== undefined) {
    const url = req.session[variableName];
    delete req.session[variableName];
    return url;
  }
}

// ----------------------------------------------------------------------------
// Provide our own error wrapper and message for an underlying thrown error.
// Useful for the user-presentable version.
// ----------------------------------------------------------------------------
const errorPropertiesToClone = [
  'stack',
  'code',
  'status',
];

export function wrapError(error, message, userIntendedMessage?: boolean) {
  const err: IReposError = new Error(message);
  err.innerError = error;
  if (error) {
    for (let i = 0; i < errorPropertiesToClone.length; i++) {
      const key = errorPropertiesToClone[i];
      const value = error[key];
      if (value && typeof value === 'number') {
        // Store as a string
        err[key] = value.toString();
      } else if (value) {
        err[key] = value;
      }
    }
  }
  if (userIntendedMessage === true) {
    err.skipLog = true;
  }
  return err;
};

// ----------------------------------------------------------------------------
// A destructive removal function for an object. Removes a single key.
// ----------------------------------------------------------------------------
export function stealValue(obj, key) {
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
export function inListInsensitive(list, value) {
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
export function isInListAnycaseInLowercaseList(list, value) {
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
export function arrayToHashById(inputArray) {
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
export function obfuscate(value, lastCharactersShowCount) {
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
export function addBreadcrumb(req, breadcrumbTitle, optionalBreadcrumbLink) {
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

export function stackSafeCallback(callback, err, item, extraItem) {
  // Works around RangeError: Maximum call stack size exceeded.
  async.setImmediate(() => {
    callback(err, item, extraItem);
  });
};

export function createSafeCallbackNoParams(cb) {
  return () => {
    exports.stackSafeCallback(cb);
  };
};

export function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve, reject) => {
    setTimeout(resolve, milliseconds);
  });
}
