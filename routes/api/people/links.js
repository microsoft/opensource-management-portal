//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

const express = require('express');
const jsonError = require('../jsonError');
const router = express.Router();
const wrapError = require('../../../utils').wrapError;

const MemberSearch = require('../../../business/memberSearch');

router.use(function (req, res, next) {
  const apiKeyRow = req.apiKeyRow;
  if (!apiKeyRow.apis) {
    return next(jsonError('The key is not authorized for specific APIs', 401));
  }
  const apis = apiKeyRow.apis.split(',');
  if (apis.indexOf('links') < 0) {
    return next(jsonError('The key is not authorized to use the get links API', 401));
  }
  return next();
});

router.get('/github/:username', (req, res, next) => {
  if (req.apiVersion == '2016-12-01') {
    return next(jsonError('This API is not supported by the API version you are using.', 400));
  }
  const username = req.params.username.toLowerCase();
  const operations = req.app.settings.operations;
  getAllUsers(req.apiVersion, operations, (error, results) => {
    if (error) {
      return next(error);
    }
    for (let i = 0; i < results.length; i++) {
      const entry = results[i];
      if (entry && entry.github && entry.github.login.toLowerCase() === username) {
        req.insights.trackMetric('ApiRequestLinkByGitHubUsername', 1);
        return res.json(entry);
      }
    }
    return next(jsonError('Could not find a link for the user', 404));
  });
});

router.get('/aad/userPrincipalName/:upn', (req, res, next) => {
  const upn = req.params.upn;
  const operations = req.app.settings.operations;
  getAllUsers(req.apiVersion, operations, (error, results) => {
    if (error) {
      return next(error);
    }
    let r = [];
    for (let i = 0; i < results.length; i++) {
      const entry = results[i];
      if (entry && entry.aad && entry.aad.userPrincipalName === upn) {
        r.push(entry);
      }
    }
    req.insights.trackEvent('ApiRequestLinkByAadUpnResult', {
      length: r.length.toString(),
      userPrincipalName: upn,
    });
    if (r.length === 0) {
      return next(jsonError('Could not find a link for the user', 404));
    }
    req.insights.trackMetric('ApiRequestLinkByAadUpn', 1);
    return res.json(r);
  });
});

router.get('/aad/:id', (req, res, next) => {
  if (req.apiVersion == '2016-12-01') {
    return next(jsonError('This API is not supported by the API version you are using.', 400));
  }
  const id = req.params.id;
  const operations = req.app.settings.operations;
  getAllUsers(req.apiVersion, operations, (error, results) => {
    if (error) {
      return next(error);
    }
    let r = [];
    for (let i = 0; i < results.length; i++) {
      const entry = results[i];
      if (entry && entry.aad && entry.aad.id === id) {
        r.push(entry);
      }
    }
    if (r.length === 0) {
      return next(jsonError('Could not find a link for the user', 404));
    }
    req.insights.trackMetric('ApiRequestLinkByAadId', 1);
    return res.json(r);
  });
});

function getAllUsers(apiVersion, operations, callback) {
  operations.getLinks((linksError, links) => {
    if (linksError) {
      linksError = wrapError(linksError, 'There was a problem retrieving link information to display alongside members.');
      return callback(jsonError(linksError, 500));
    }
    operations.getMembers(null, {}, (error, members) => {
      if (error) {
        error = wrapError(error, 'There was a problem getting the members list.');
        return callback(jsonError(error, 500));
      }
      const search = new MemberSearch(members, {
        type: 'linked',
        links: links,
        getCorporateProfile: operations.mailAddressProvider.getCorporateEntry,
        pageSize: 200000,
      });
      try {
        search.search(1).then(() => {
          const sr = search.members;
          const results = [];
          sr.forEach(member => {
            const entry = {
              github: {
                id: member.account.id,
                login: member.account.login,
              },
            };
            if (member.orgs) {
              entry.github.organizations = Object.getOwnPropertyNames(member.orgs);
            }
            if (member.corporate) {
              const corporatePropertyName = apiVersion === '2016-12-01' ? 'corporate' : 'aad'; // This was renamed to be provider name-based
              entry[corporatePropertyName] = {
                alias: member.corporate.alias,
                preferredName: member.corporate.preferredName,
                userPrincipalName: member.corporate.userPrincipalName,
                emailAddress: member.corporate.emailAddress,
              };
              const corporateIdPropertyName = apiVersion === '2016-12-01' ? 'aadId' : 'id'; // Now just 'id'
              entry[corporatePropertyName][corporateIdPropertyName] = member.corporate.aadId;
            }
            results.push(entry);
          });
          return callback(null, results);
        }).catch(callback);
      } catch (initialError) {
        return callback(jsonError(initialError, 400));
      }
    });
  });
}

router.get('/', (req, res, next) => {
  const operations = req.app.settings.operations;
  getAllUsers(req.apiVersion, operations, (error, results) => {
    if (error) {
      return next(error);
    }
    req.insights.trackMetric('ApiRequestLinks', 1);
    res.json(results);
  });
});

module.exports = router;
