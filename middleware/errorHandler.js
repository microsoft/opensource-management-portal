//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

/*eslint no-console: ["error", { allow: ["error", "log"] }] */

const querystring = require('querystring');

function redactRootPathsFromString(string, path) {
  if (typeof string === 'string' && string.includes && string.split) {
    return string.split(path).join('[app]');
  }
  return string;
}

function redactRootPaths(view) {
  const path = process.cwd();
  if (typeof view === 'object') {
    for (var property in view) {
      if (view.hasOwnProperty(property)) {
        var value = view[property];
        if (typeof value === 'string') {
          view[property] = redactRootPathsFromString(value, path);
        }
      }
    }
  } else if (typeof view === 'string') {
    return redactRootPathsFromString(view, path);
  }
  return view;
}

function containsNewlinesNotHtml(error) {
  if (error && error.message && error.message.includes && error.message.split) {
    var newlines = error.message.split('\n');
    return newlines.length > 3 && !error.message.includes('</');
  }
  return false;
}

module.exports = function (err, req, res, next) {
  var config = null;
  var errorStatus = err && err.status ? err.status : undefined;
  if (req && req.app && req.app.settings && req.app.settings.dataclient && req.app.settings.runtimeConfig) {
    config = req.app.settings.runtimeConfig;
    var version = config && config.logging && config.logging.version ? config.logging.version : '?';
    var dc = req.app.settings.dataclient;
    if (config.logging.errors && err.status !== 403 && err.skipLog !== true) {
      dc.insertErrorLogEntry(version, req, err);
    }
  }
  if (err !== undefined && err.skipLog !== true) {
    console.log('Error: ' + (err && err.message ? err.message : 'Error is undefined.'));
    if (err.stack) {
      console.error(err.stack);
    }
    if (err.innerError) {
      var inner = err.innerError;
      console.log('Inner: ' + inner.message);
      if (inner.stack) {
        console.log(inner.stack);
      }
    }
  }
  // Bubble OAuth errors to the forefront... this is the rate limit scenario.
  if (err && err.oauthError && err.oauthError.statusCode && err.oauthError.statusCode && err.oauthError.data) {
    var detailed = err.message;
    err = err.oauthError;
    err.status = err.statusCode;
    var data = JSON.parse(err.data);
    if (data && data.message) {
      err.message = err.statusCode + ': ' + data.message;
    } else {
      err.message = err.statusCode + ' Unauthorized received. You may have exceeded your GitHub API rate limit or have an invalid auth token at this time.';
    }
    err.detailed = detailed;
  }
  // Don't leak the Redis connection information.
  if (err && err.message && err.message.indexOf('Redis connection') >= 0 && err.message.indexOf('ETIMEDOUT')) {
    err.message = 'The session store was temporarily unavailable. Please try again.';
    err.detailed = 'Azure Redis Cache';
  }
  if (res.headersSent) {
    console.error('Headers were already sent.');
    return next(err);
  }
  if (err && err.forceSignOut === true && req && req.logout) {
    req.logout();
  }
  var safeMessage = redactRootPaths(err.message);
  const view = {
    message: safeMessage,
    encodedMessage: querystring.escape(safeMessage),
    messageHasNonHtmlNewlines: containsNewlinesNotHtml(err),
    serviceBanner: config && config.serviceBanner ? config.serviceBanner : undefined,
    detailed: err && err.detailed ? redactRootPaths(err.detailed) : undefined,
    encodedDetailed: err && err.detailed ? querystring.escape(redactRootPaths(err.detailed)) : undefined,
    errorFancyLink: err && err.fancyLink ? err.fancyLink : undefined,
    errorStatus: errorStatus,
    skipLog: err.skipLog,
    error: {},
    title: err.status === 404 ? 'Not Found' : 'Oops',
    user: req.user,
    config: config && config.obfuscatedConfig ? config.obfuscatedConfig : null,
  };
  res.status(err.status || 500);
  res.render('error', view);
};
