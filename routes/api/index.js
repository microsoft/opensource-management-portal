//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

const basicAuth = require('basic-auth');
const crypto = require('crypto');
const express = require('express');
const jsonError = require('./jsonError');
const router = express.Router();

const apiClient = require('./client');
const apiPeople = require('./people');
const apiWebhook = require('./webhook');

const OpenSourceUser = require('../../lib/context');

const createRepo = require('./createRepo');

const hardcodedApiVersions = [
  '2017-03-08',
  '2016-12-01',
];

router.use('/client', apiClient);
router.use('/webhook', apiWebhook);

// Require a "preview" API version: ?api-version=2016-12-01
router.use((req, res, next) => {
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

router.use(function (req, res, next) {
  const user = basicAuth(req);
  const key = user? (user.pass || user.name) : null;
  if (!key) {
    return next(jsonError('No key supplied', 400));
  }
  const sha1 = crypto.createHash('sha1');
  sha1.update(key);
  const hashValue = sha1.digest('hex');

  // { owner, description, orgs (comma-sep list) }
  const dc = req.app.settings.dataclient;
  const settingType = 'apiKey';
  const partitionKey = settingType;
  const rowKey = `${settingType}${hashValue}`;
  dc.getSetting(partitionKey, rowKey, (error, setting) => {
    const apiEventProperties = {
      keyHash: hashValue,
      apiVersion: req.apiVersion,
      url: req.originalUrl || req.url,
    };
    if (error) {
      apiEventProperties.failed = true;
      apiEventProperties.message = error.message;
      apiEventProperties.statusCode = error.statusCode;
    }
    req.insights.trackEvent('ApiRequest', apiEventProperties);
    if (error) {
      req.insights.trackMetric('ApiInvalidKey', 1);
      req.insights.trackException(error);
      return next(jsonError(error.statusCode === 404 ? 'Key not authorized' : error.message, 401));
    } else {
      req.insights.trackMetric('ApiRequest', 1);
      req.apiKeyRow = setting;
      next();
    }
  });
});

router.use('/people', apiPeople);

router.use('/:org', function (req, res, next) {
  const orgName = req.params.org;
  const apiKeyRow = req.apiKeyRow;
  if (!apiKeyRow.orgs) {
    return next(jsonError('There is a problem with the key configuration', 412));
  }
  // '*'' is authorized for all organizations in this configuration environment
  if (apiKeyRow.orgs !== '*') {
    const orgList = apiKeyRow.orgs.toLowerCase().split(',');
    if (orgList.indexOf(orgName.toLowerCase()) < 0) {
      return next(jsonError('The key is not authorized for this organization', 401));
    }
  }

  if (!apiKeyRow.apis) {
    return next(jsonError('The key is not authorized for specific APIs', 401));
  }
  const apis = apiKeyRow.apis.split(',');
  if (apis.indexOf('createRepo') < 0) {
    return next(jsonError('The key is not authorized to use the repo create APIs', 401));
  }

  const providers = req.app.settings.providers;
  const operations = providers.operations;
  const options = {
    config: req.app.settings.runtimeConfig,
    dataClient: providers.dataclient,
    ossDbClient: providers.ossDbConnection,
    githubLibrary: providers.github,
    operations: providers.operations,
  };
  new OpenSourceUser(options, function (error, instance) {
    req.legacyUserContext = instance;

    let organization = null;
    try {
      organization = operations.getOrganization(orgName);
    } catch (ex) {
      return next(jsonError(ex), 400);
    }
    req.organization = organization;
    return next();
  });
});

router.post('/:org/repos', function (req, res, next) {
  const convergedObject = Object.assign({}, req.headers);
  req.insights.trackEvent('ApiRepoCreateRequest', convergedObject);
  Object.assign(convergedObject, req.body);
  delete convergedObject.access_token;
  delete convergedObject.authorization;

  const token = req.organization.getRepositoryCreateGitHubToken();
  createRepo(req, res, convergedObject, token, next, true /* send the response directly back without the callback */);
});

module.exports = router;
