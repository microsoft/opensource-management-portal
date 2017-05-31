//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

// This code adopted from our existing jobs code

const cache = require('memory-cache');
const request = require('request');

module.exports = function createMicrosoftGraphProvider(graphOptions) {
  const secondsString = graphOptions.tokenCacheSeconds || '60';
  const tokenCacheMilliseconds = parseInt(secondsString) * 1000;
  function getGraphAccessToken(callback) {
    const clientId = graphOptions.clientId;
    const clientSecret = graphOptions.clientSecret;
    if (!clientId || !clientSecret) {
      return callback(null, new Error('The graph provider requires an AAD clientId and clientSecret.'));
    }
    const tokenEndpoint = 'https://login.microsoftonline.com/microsoft.com/oauth2/token';
    // These are the parameters necessary for the OAuth 2.0 Client Credentials Grant Flow.
    // For more information, see Service to Service Calls Using Client Credentials (https://msdn.microsoft.com/library/azure/dn645543.aspx).
    const requestParams = {
      'grant_type': 'client_credentials',
      'client_id': clientId,
      'client_secret': clientSecret,
      'resource': 'https://graph.microsoft.com'
    };
    request.post({
      url: tokenEndpoint,
      form: requestParams
    }, function (err, response, body) {
      if (err) {
        return callback(err, null);
      }
      const parsedBody = JSON.parse(body);
      if (parsedBody.error) {
        return callback(new Error(parsedBody.error.message), null);
      } else {
        return callback(null, parsedBody.access_token);
      }
    });
  }

  function getGraphOptions(accessToken) {
    return {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      json: true,
    };
  }

  function getToken(callback) {
    const tokenKey = graphOptions.clientId;
    const token = cache.get(tokenKey);
    if (token) {
      return callback(null, token);
    }
    getGraphAccessToken((error, t) => {
      if (error) {
        return callback(error);
      }
      cache.put(tokenKey, t, tokenCacheMilliseconds);
      return callback(null, t);
    });
  }

  function getUserById(aadId, options, subResource, callback) {
    if (!callback && typeof(subResource) === 'function') {
      callback = subResource;
      subResource = null;
    }
    const extraPath = subResource ? `/${subResource}` : '';
    const url = `https://graph.microsoft.com/v1.0/users/${aadId}${extraPath}?$select=id,displayName,givenName,mail,userPrincipalName`;
    request.get(url, options, (err, response, body) => {
      if (err) {
        return callback(err, null);
      } else if (response.statusCode >= 400) {
        return callback(new Error(`Invalid status code: ${response.statusCode}`), null);
      } else if (body === undefined) {
        return callback(new Error('user not found'), null);
      } else if (body.error) {
        return callback(new Error(body.error.message), null);
      } else {
        return callback(null, body);
      }
    });
  }

  function getTokenThenEntity(aadId, resource, callback) {
    getToken((error, token) => {
      if (error) {
        return callback(error);
      }
      getUserById(aadId, getGraphOptions(token), resource, callback);
    });
  }

  return {
    getUserById: (aadId, callback) => {
      getTokenThenEntity(aadId, null, callback);
    },
    getManagerById: (aadId, callback) => {
      getTokenThenEntity(aadId, 'manager', callback);
    },
    getUserAndManagerById: (aadId, callback) => {
      getTokenThenEntity(aadId, null, (error, user) => {
        if (error) {
          return callback(error);
        }
        getTokenThenEntity(aadId, 'manager', (noManager, manager) => {
          if (!error && manager) {
            user.manager = manager;
          }
          callback(null, user);
        });
      });
    },
  };
};
