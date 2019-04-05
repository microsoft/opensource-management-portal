//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

import express = require('express');
import { ReposAppRequest } from '../../../transitional';
import { jsonError } from '../../../middleware/jsonError';
import { MemberSearch } from '../../../business/memberSearch';
import { ICorporateLink } from '../../../business/corporateLink';
import { Operations } from '../../../business/operations';

const router = express.Router();
const wrapError = require('../../../utils').wrapError;

interface ILinksApiRequest extends ReposAppRequest {
  apiKeyRow?: any;
  apiVersion?: string;
}

const unsupportedApiVersions = [
  '2016-12-01',
];

const extendedLinkApiVersions = [
  '2019-02-01',
];

router.use(function (req: ILinksApiRequest, res, next) {
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

router.get('/', (req: ILinksApiRequest, res, next) => {
  const operations = req.app.settings.operations;
  const skipOrganizations = req.query.showOrganizations !== undefined && !!req.query.showOrganizations;
  const showTimestamps = req.query.showTimestamps !== undefined && req.query.showTimestamps === 'true';
  getAllUsers(req.apiVersion, operations, skipOrganizations, showTimestamps, (error, results) => {
    if (error) {
      return next(error);
    }
    req.insights.trackMetric({ name: 'ApiRequestLinks', value: 1 });
    res.set('Content-Type', 'application/json');
    res.send(JSON.stringify(results, undefined, 2));
  });
});

router.get('/github/:username', (req: ILinksApiRequest, res, next) => {
  if (unsupportedApiVersions.includes(req.apiVersion)) {
    return next(jsonError('This API is not supported by the API version you are using.', 400));
  }
  const username = req.params.username.toLowerCase();
  const operations = req.app.settings.operations as Operations;
  const skipOrganizations = req.query.showOrganizations !== undefined && !!req.query.showOrganizations;
  const showTimestamps = req.query.showTimestamps !== undefined && req.query.showTimestamps === 'true';
  getAllUsers(req.apiVersion, operations, skipOrganizations, showTimestamps, (error, results) => {
    if (error) {
      return next(error);
    }
    for (let i = 0; i < results.length; i++) {
      const entry = results[i];
      if (entry && entry.github && entry.github.login.toLowerCase() === username) {
        req.insights.trackMetric({ name: 'ApiRequestLinkByGitHubUsername', value: 1 });
        return res.json(entry);
      }
    }
    return next(jsonError('Could not find a link for the user', 404));
  });
});

router.get('/aad/userPrincipalName/:upn', (req: ILinksApiRequest, res, next) => {
  const upn = req.params.upn;
  const operations = req.app.settings.operations;
  const skipOrganizations = req.query.showOrganizations !== undefined && !!req.query.showOrganizations;
  const showTimestamps = req.query.showTimestamps !== undefined && req.query.showTimestamps === 'true';
  getAllUsers(req.apiVersion, operations, skipOrganizations, showTimestamps, (error, results) => {
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
    req.insights.trackEvent({
      name: 'ApiRequestLinkByAadUpnResult',
      properties: {
        length: r.length.toString(),
        userPrincipalName: upn,
      },
    });
    if (r.length === 0) {
      return next(jsonError('Could not find a link for the user', 404));
    }
    req.insights.trackMetric({ name: 'ApiRequestLinkByAadUpn', value: 1 });
    return res.json(r);
  });
});

router.get('/aad/:id', (req: ILinksApiRequest, res, next) => {
  if (req.apiVersion == '2016-12-01') {
    return next(jsonError('This API is not supported by the API version you are using.', 400));
  }
  const id = req.params.id;
  const skipOrganizations = req.query.showOrganizations !== undefined && !!req.query.showOrganizations;
  const showTimestamps = req.query.showTimestamps !== undefined && req.query.showTimestamps === 'true';
  const operations = req.app.settings.operations;
  getAllUsers(req.apiVersion, operations, skipOrganizations, showTimestamps, (error, results) => {
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
    req.insights.trackMetric({ name: 'ApiRequestLinkByAadId', value: 1 });
    return res.json(r);
  });
});

function getAllUsers(apiVersion, operations: Operations, skipOrganizations: boolean, showTimestamps: boolean, callback) {
  operations.getLinks(undefined, (linksError, links) => {
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
          const isExpandedView = extendedLinkApiVersions.includes(apiVersion);
          const results = [];
          sr.forEach(member => {
            const entry = {
              github: {
                id: member.account.id,
                login: member.account.login,
                organizations: undefined,
              },
              isServiceAccount: undefined,
              serviceAccountContact: undefined,
            };
            if (isExpandedView) {
              entry.github['avatar'] = member.account.avatar_url;
            }
            if (!skipOrganizations && member.orgs) {
              entry.github.organizations = Object.getOwnPropertyNames(member.orgs);
            }
            // '2017-09-01' added 'isServiceAccount'; so '2016-12-01' & '2017-03-08' do not have it
            const link = member.link as ICorporateLink;
            if (showTimestamps && link && link['created']) {
              entry['timestamp'] = link['created'];
            }
            if (link && link.isServiceAccount === true && apiVersion !== '2016-12-01' && apiVersion !== '2017-03-08') {
              entry.isServiceAccount = true;
              if (isExpandedView && link.isServiceAccount && link.serviceAccountMail) {
                entry.serviceAccountContact = link.serviceAccountMail;
              }
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

module.exports = router;
