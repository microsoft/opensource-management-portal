//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

const crypto = require('crypto');
const express = require('express');

const apiUserContext = require('./apiUserContext');
const jsonError = require('../../middleware/jsonError');
const router = express.Router();

const settingType = 'localExtensionKey';
const tokenExpirationMs = 1000 * 60 * 60 * 24 * 14; // 14 days

const thisApiScopeName = 'extension';

router.use(function (req, res, next) {
  const apiKeyRow = req.apiKeyRow;
  if (!apiKeyRow.apis) {
    return next(jsonError('The key is not authorized for specific APIs', 403));
  }
  const apis = apiKeyRow.apis.split(',');
  if (apis.indexOf(thisApiScopeName) < 0) {
    return next(jsonError('The key is not authorized to use the extension API', 403));
  }
  return next();
});

function overwriteUserContext(req, res, next) {
  const apiKeyRow = req.apiKeyRow;
  const aadId = apiKeyRow.owner;
  if (!aadId) {
    return next(jsonError('No key owner', 403));
  }
  req.userContextOverwriteRequest = {
    user: {
      azure: {
        oid: aadId,
      },
    },
  };
  return next();
}

router.get('/', overwriteUserContext, apiUserContext, (req, res) => {
  // Basic info route, used to validate new users
  const operations = req.app.settings.providers.operations;
  const id = req.legacyUserContext.id.github;
  const login = req.legacyUserContext.usernames.github;
  const user = req.legacyUserContext.modernUser();
  //if (!user) {
    //return next(jsonError('User data could not be resolved', 400));
  //}

  // link display upn
  let displayUpn = user && user.link && user.link.aadupn ? user.link.aadupn : null; // user link

  // vsts provider
  if (!displayUpn && req.apiKeyRow && req.apiKeyRow.upn) {
    displayUpn = req.apiKeyRow.upn;
  }

  const config = operations.config;
  const link = user ? user.link : null;
  //if (!link) {
    //return next(jsonError(`Link not available for the user ${login}`, 400));
  //}

  const connectionInformation = {};

  if (link) {
    // project into the connection info
    connectionInformation.link = {
      github: {
        id: id,
        login: login,
      },
      corporate: {
        preferredName: link.aadname,
        userPrincipalName: link.aadupn,
        id: link.aadoid,
      },
    };
  }

  connectionInformation.operations = config.brand;

  // auth info
  if (req.apiKeyRowProvider && req.apiKeyRow) {
    connectionInformation.auth = {
      provider: req.apiKeyRowProvider,
      id: req.apiKeyRow.owner,
      upn: displayUpn,
    };
  }

  return res.json(connectionInformation);
});

router.get('/metadata', getLocalEncryptionKeyMiddleware, overwriteUserContext, apiUserContext, (req, res) => {
  const localKey = res.localKey;
  const operations = req.app.settings.providers.operations;
  const id = req.legacyUserContext.id.github;
  const login = req.legacyUserContext.usernames.github;
  const user = req.legacyUserContext.modernUser();
  const link = user ? user.link : null;
  const orgData = getSanitizedOrganizations(operations);
  const config = operations.config;

  const metadata = {
    extension: {
      localEncryptionKey: localKey,
    },
    operations: config.brand,
    serviceMessage: config.serviceMessage,
    reference: config.corporate.trainingResources ? config.corporate.trainingResources.footer : {},
    organizations: orgData,
    site: config.microsoftOpenSource,
  };

  if (link) {
    metadata.link = {
      github: {
        id: id,
        login: login,
      },
      corporate: {
        preferredName: link.aadname,
        userPrincipalName: link.aadupn,
      },
    };
  }

  res.json(metadata);
});

function getSanitizedOrganizations(operations) {
  const value = {
    list: operations.organizationNames,
    settings: {},
  };
  value.list.map(function (organizationName) {
    const organization = operations.getOrganization(organizationName);
    const basics = {
      locked: organization.locked,
      createRepositoriesOnGitHub: organization.createRepositoriesOnGitHub,
      legacyTrainingResourcesLink: organization.legacyTrainingResourcesLink,
      privateEngineering: organization.privateEngineering,
      externalMembersPermitted: organization.externalMembersPermitted,
      description: organization.description,
      priority: organization.priority,
      entities: organization.legalEntities,
      // broadAccessTeams: organization.broadAccessTeams,
      // systemTeamIds: organization.systemTeamIds,
    };
    value.settings[organizationName] = basics;
  });
  return value;
}

function getLocalEncryptionKeyMiddleware(req, res, next) {
  const dc = req.app.settings.dataclient;
  const apiKeyRow = req.apiKeyRow;
  const insights = req.insights;
  getOrCreateLocalEncryptionKey(insights, dc, apiKeyRow, (error, key) => {
    if (!key) {
      error = new Error('No key could be generated');
    }
    if (error) {
      return next(jsonError(error, 500));
    }
    res.localKey = key;
    return next();
  });
}

function getLocalEncryptionKey(dc, userId, callback) {
  const rowKey = userId;
  dc.getSetting(settingType, rowKey, (error, localRow) => {
    if (error && error.statusCode === 404) {
      return callback();
    }
    const now = new Date();
    const expires = new Date(localRow.Timestamp.getTime() + tokenExpirationMs);
    if (expires < now || !localRow.localDataKey) {
      return dc.deleteSetting(settingType, rowKey, () => {
        return callback();
      });
    }
    return callback(error ? error : null, error ? null : localRow.localDataKey);
  });
}

function createLocalEncryptionKey(insights, dc, ownerId, callback) {
  const localDataKey = crypto.randomBytes(32).toString('base64');
  const row = {
    localDataKey: localDataKey, // this known column will be encrypted in table
  };
  dc.setSetting(settingType, ownerId, row, error => {
    if (error) {
      return callback(error);
    }
    insights.trackEvent({ name: 'ExtensionNewLocalKeyGenerated' });
    insights.trackMetric({ name: 'ExtensionNewLocalKeys', value: 1 });
    return callback(null, localDataKey);
  });
}

function getOrCreateLocalEncryptionKey(insights, dc, apiKeyRow, callback) {
  const ownerId = apiKeyRow.RowKey || apiKeyRow.owner;
  if (!ownerId) {
    return callback(new Error('Owner identity required'));
  }
  getLocalEncryptionKey(dc, ownerId, (getKeyError, key) => {
    if (getKeyError) {
      return callback(getKeyError);
    }
    if (key) {
      return callback(null, key);
    }
    return createLocalEncryptionKey(insights, dc, ownerId, callback);
  });
}

router.use('*', (req, res, next) => {
  return next(jsonError('API not found', 404));
});

module.exports = router;
