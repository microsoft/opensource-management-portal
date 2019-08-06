//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

import express = require('express');
const router = express.Router();

import { ReposAppRequest, IProviders } from '../../transitional';

import { jsonError } from '../../middleware/jsonError';
import { IApiRequest } from '../../middleware/apiReposAuth';

const apiClient = require('./client');
const apiExtension = require('./extension');
const apiPeople = require('./people');
const apiWebhook = require('./webhook');

import { AzureDevOpsAuthenticationMiddleware } from '../../middleware/apiVstsAuth';
import { ReposApiAuthentiction } from '../../middleware/apiReposAuth';
import { CreateRepository, CreateRepositoryCallback } from './createRepo';
const supportMultipleAuthProviders = require('../../middleware/supportMultipleAuthProviders');

const hardcodedApiVersions = [
  '2019-02-01',
  '2017-09-01',
  '2017-03-08',
  '2016-12-01',
];

router.use('/client', apiClient);
router.use('/webhook', apiWebhook);

// Require a "preview" API version: ?api-version=2016-12-01
router.use((req: IApiRequest, res, next) => {
  const apiVersion = req.query['api-version'] || req.headers['api-version'];
  if (!apiVersion) {
    return next(jsonError('This endpoint requires that an API Version be provided.', 422));
  }
  if (apiVersion.toLowerCase() === '2016-09-22_Preview'.toLowerCase()) {
    return next(jsonError('This endpoint no longer supports the original preview version. Please update your client to use a newer version such as ' + hardcodedApiVersions[0], 422));
  }
  if (hardcodedApiVersions.indexOf(apiVersion.toLowerCase()) < 0) {
    return next(jsonError('This endpoint does not support the API version you provided at this time.', 422));
  }
  req.apiVersion = apiVersion;
  return next();
});

//-----------------------------------------------------------------------------
// AUTHENTICATION: VSTS or repos
//-----------------------------------------------------------------------------
const multipleProviders = supportMultipleAuthProviders([
  AzureDevOpsAuthenticationMiddleware,
  ReposApiAuthentiction,
]);

router.use('/people', multipleProviders, apiPeople);
router.use('/extension', multipleProviders, apiExtension);

//-----------------------------------------------------------------------------
// AUTHENTICATION: repos (specific to this app)
//-----------------------------------------------------------------------------
router.use(ReposApiAuthentiction);

router.use('/:org', function (req: IApiRequest, res, next) {
  const orgName = req.params.org;
  if (!req.apiKeyToken.organizationScopes) {
    return next(jsonError('There is a problem with the key configuration (no organization scopes)', 412));
  }
  // '*'' is authorized for all organizations in this configuration environment
  if (!req.apiKeyToken.hasOrganizationScope(orgName)) {
    return next(jsonError('The key is not authorized for this organization', 401));
  }
  if (!req.apiKeyToken.scopes) {
    return next(jsonError('There is a problem with the key configuration (no specific API scopes)', 412));
  }
  if (!req.apiKeyToken.hasScope('createRepo')) {
    return next(jsonError('The key is not authorized to use the repo create APIs', 401));
  }

  const providers = req.app.settings.providers as IProviders;
  const operations = providers.operations;
  let organization = null;
  try {
    organization = operations.getOrganization(orgName);
  } catch (ex) {
    return next(jsonError(ex, 400));
  }
  req.organization = organization;
  return next();
});

router.post('/:org/repos', function (req: ReposAppRequest, res, next) {
  const convergedObject = Object.assign({}, req.headers);
  req.insights.trackEvent({ name: 'ApiRepoCreateRequest', properties: convergedObject });
  Object.assign(convergedObject, req.body);
  delete convergedObject.access_token;
  delete convergedObject.authorization;

  const token = req.organization.getRepositoryCreateGitHubToken();
  CreateRepositoryCallback(req, res, convergedObject, token, (error, repoCreateResponse) => {
    if (error) {
      return next(error);
    }
    res.status(201);
    return res.json(repoCreateResponse);
  });
});

module.exports = router;
