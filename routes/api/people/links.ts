//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import express = require('express');
import asyncHandler from 'express-async-handler';

import { jsonError } from '../../../middleware/jsonError';
import { MemberSearch } from '../../../business/memberSearch';
import { ICorporateLink } from '../../../business/corporateLink';
import { Operations, ICrossOrganizationMembersResult } from '../../../business/operations';
import { IApiRequest } from '../../../middleware/apiReposAuth';
import postLinkApi from './link';

const router = express.Router();
const wrapError = require('../../../utils').wrapError;

const unsupportedApiVersions = [
  '2016-12-01',
];

const extendedLinkApiVersions = [
  '2019-02-01',
];

router.use(function (req: IApiRequest, res, next) {
  const token = req.apiKeyToken;
  if (!token.scopes) {
    return next(jsonError('The key is not authorized for specific APIs', 401));
  }
  if (!token.hasScope('links') && !token.hasScope('link')) {
  return next(jsonError('The key is not authorized to use the links API', 401));
  }
  return next();
});

router.post('/', asyncHandler(postLinkApi));

router.get('/', asyncHandler(async (req: IApiRequest, res, next) => {
  const operations = req.app.settings.operations;
  const skipOrganizations = req.query.showOrganizations !== undefined && !!req.query.showOrganizations;
  const showTimestamps = req.query.showTimestamps !== undefined && req.query.showTimestamps === 'true';
  const results = await getAllUsers(req.apiVersion, operations, skipOrganizations, showTimestamps);
  req.insights.trackMetric({ name: 'ApiRequestLinks', value: 1 });
  res.set('Content-Type', 'application/json');
  res.send(JSON.stringify(results, undefined, 2));
}));

router.get('/:linkid', asyncHandler(async (req: IApiRequest, res, next) => {
  if (unsupportedApiVersions.includes(req.apiVersion)) {
    return next(jsonError('This API is not supported by the API version you are using.', 400));
  }
  const linkid = req.params.linkid.toLowerCase();
  const operations = req.app.settings.operations as Operations;
  const skipOrganizations = req.query.showOrganizations !== undefined && !!req.query.showOrganizations;
  const showTimestamps = req.query.showTimestamps !== undefined && req.query.showTimestamps === 'true';
  const results = await getAllUsers(req.apiVersion, operations, skipOrganizations, showTimestamps, true);
  for (let i = 0; i < results.length; i++) {
    const entry = results[i];
    if (entry && entry.id === linkid) {
      req.insights.trackMetric({ name: 'ApiRequestLinkByLinkId', value: 1 });
      return res.json(entry);
    }
  }
  return next(jsonError('Could not find the link', 404));
}));

router.get('/github/:username', asyncHandler (async (req: IApiRequest, res, next) => {
  if (unsupportedApiVersions.includes(req.apiVersion)) {
    return next(jsonError('This API is not supported by the API version you are using.', 400));
  }
  const username = req.params.username.toLowerCase();
  const operations = req.app.settings.operations as Operations;
  const skipOrganizations = req.query.showOrganizations !== undefined && !!req.query.showOrganizations;
  const showTimestamps = req.query.showTimestamps !== undefined && req.query.showTimestamps === 'true';
  const results = await getAllUsers(req.apiVersion, operations, skipOrganizations, showTimestamps);
  for (let i = 0; i < results.length; i++) {
    const entry = results[i];
    if (entry && entry.github && entry.github.login.toLowerCase() === username) {
      req.insights.trackMetric({ name: 'ApiRequestLinkByGitHubUsername', value: 1 });
      return res.json(entry);
    }
  }
  return next(jsonError('Could not find a link for the user', 404));
}));

router.get('/aad/userPrincipalName/:upn', asyncHandler(async (req: IApiRequest, res, next) => {
  const upn = req.params.upn;
  const operations = req.app.settings.operations;
  const skipOrganizations = req.query.showOrganizations !== undefined && !!req.query.showOrganizations;
  const showTimestamps = req.query.showTimestamps !== undefined && req.query.showTimestamps === 'true';
  const results = await getAllUsers(req.apiVersion, operations, skipOrganizations, showTimestamps);
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
}));

router.get('/aad/:id', asyncHandler(async (req: IApiRequest, res, next) => {
  if (req.apiVersion == '2016-12-01') {
    return next(jsonError('This API is not supported by the API version you are using.', 400));
  }
  const id = req.params.id;
  const skipOrganizations = req.query.showOrganizations !== undefined && !!req.query.showOrganizations;
  const showTimestamps = req.query.showTimestamps !== undefined && req.query.showTimestamps === 'true';
  const operations = req.app.settings.operations;
  const results = await getAllUsers(req.apiVersion, operations, skipOrganizations, showTimestamps);
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
}));

async function getAllUsers(apiVersion, operations: Operations, skipOrganizations: boolean, showTimestamps: boolean, showLinkIds?: boolean): Promise<any[]> {
  let links: ICorporateLink[] = null;
  try {
    links = await operations.getLinks();
  } catch (linksError) {
    linksError = wrapError(linksError, 'There was a problem retrieving link information to display alongside members.');
    throw jsonError(linksError, 500);
  }
  let members: ICrossOrganizationMembersResult;
  try {
    // TODO: this is a cross-org map!? validate return type...
    members = await operations.getMembers();
  } catch (error) {
    error = wrapError(error, 'There was a problem getting the members list.');
    throw jsonError(error, 500);
  }
  const search = new MemberSearch(members, {
    type: 'linked',
    links,
    providers: operations.providers,
    pageSize: 200000,
  });
  try {
    await search.search(1);

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
      if (showLinkIds && member && member.link && member.link.id) {
        entry['id'] = member.link.id;
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
          preferredName: member.corporate.preferredName || member.corporate.corporateDisplayName,
          userPrincipalName: member.corporate.userPrincipalName || member.corporate.corporateUsername,
          emailAddress: member.corporate.emailAddress,
        };
        const corporateIdPropertyName = apiVersion === '2016-12-01' ? 'aadId' : 'id'; // Now just 'id'
        entry[corporatePropertyName][corporateIdPropertyName] = member.corporate.aadId || link?.corporateId;
      }
      results.push(entry);
    });
    return results;
  } catch (error) {
    throw jsonError(error, 400);
  }
}

module.exports = router;
