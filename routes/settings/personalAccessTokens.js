//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

const async = require('async');
const crypto = require('crypto');
const express = require('express');

const router = express.Router();

const settingType = 'apiKey';
const serviceName = 'repos-pat';
const tokenExpirationMs = 1000 * 60 * 60 * 24 * 180; // 180 days

function translateTableToEntities(personalAccessTokens) {
  const now = new Date();
  if (personalAccessTokens && Array.isArray(personalAccessTokens)) {
    personalAccessTokens.forEach(row => {
      const original = Object.assign({}, row);
      row._entity = original;
      let expired = false;
      if (row.expires) {
        const expiration = new Date(row.expires);
        row.expires = expiration.toDateString();
        if (expiration < now) {
          expired = true;
        }
      }
      row.expired = expired;
      if (row.apis) {
        row.apis = row.apis.split(',');
      }
      // So that we do not share the hashed key with the user, we
      // build a hash of that and the timestamp to offer a single-version
      // tag to use for delete operations, etc.
      const concat = row.Timestamp.getTime() + row.RowKey;
      row.identifier = crypto.createHash('sha1').update(concat).digest('hex').substring(0, 10);
    });
  }
  return personalAccessTokens;
}

function getPersonalAccessTokens(req, res, next) {
  const dc = req.app.settings.dataclient;
  const aadId = req.legacyUserContext.id.aad;

  dc.getSettingByProperty(settingType, 'owner', aadId, (error, personalAccessTokens) => {
    if (error) {
      return next(error);
    }
    req.personalAccessTokens = translateTableToEntities(personalAccessTokens);
    return next();
  });
}

function view(req, res) {
  const personalAccessTokens = req.personalAccessTokens;
  req.legacyUserContext.render(req, res, 'settings/personalAccessTokens', 'Personal access tokens', {
    personalAccessTokens: personalAccessTokens,
    newKey: res.newKey,
    isPreviewUser: req.isPreviewUser,
  });
}

router.use(getPersonalAccessTokens);

router.use(previewFeatures);

router.get('/', view);

function previewFeatures(req, res, next) {
  // const aadId = req.legacyUserContext.id.aad;
  // Allowing any one to use for now
  req.isPreviewUser = true;
  return next();
}

function requirePreviewFeatureAccess(req, res, next) {
  const insights = req.insights;
  if (!req.isPreviewUser === true) {
    const err = new Error('You are not authorized for access to preview features');
    err.skipLog = true;
    if (insights) {
      insights.trackEvent('PersonalAccessTokenPreviewFeatureBlock', {
        aadId: req.legacyUserContext.id.aad,
        endpoint: req.originalUrl,
      });
    }
    return next(err);
  }
  return next();
}

router.get('/extension', requirePreviewFeatureAccess, (req, res) => {
  const personalAccessTokens = req.personalAccessTokens;
  req.legacyUserContext.render(req, res, 'settings/extension', 'Install the browser extension (preview)', {
    personalAccessTokens: personalAccessTokens,
    newKey: res.newKey,
    newTokenDescription: 'Extension ' + (new Date()).toDateString(),
  });
});

function createToken(req, res, next) {
  const insights = req.insights;

  const description = req.body.description;
  if (!description) {
    return next(new Error('A description is required to create a new Personal Access Token'));
  }
  const newKey = crypto.randomBytes(32).toString('base64');
  const hash = crypto.createHash('sha1').update(newKey).digest('hex');

  const now = new Date();
  const expiration = new Date(now.getTime() + tokenExpirationMs);

  const dc = req.app.settings.dataclient;
  const partitionKey = settingType;
  const aadId = req.legacyUserContext.id.aad;
  const rowKey = `${partitionKey}${hash}`;

  insights.trackEvent('ReposCreateTokenStart', {
    id: aadId,
    description: description,
  });

  const row = {
    description: description,
    owner: aadId,
    service: serviceName,
    apis: 'extension,links',
    expires: expiration.toISOString(),
  };

  dc.setSetting(partitionKey, rowKey, row, insertError => {
    if (insertError) {
      insights.trackEvent('ReposCreateTokenFailure', {
        id: aadId,
        description: description,
      });
      return next(insertError);
    }

    getPersonalAccessTokens(req, res, () => {
      insights.trackEvent('ReposCreateTokenFinish', {
        id: aadId,
        description: description,
      });

      res.newKey = newKey;
      return view(req, res, next);
    });
  });
}

router.post('/create', requirePreviewFeatureAccess, createToken);
router.post('/extension', requirePreviewFeatureAccess, createToken);

router.post('/delete', (req, res, next) => {
  const dc = req.app.settings.dataclient;
  const revokeAll = req.body.revokeAll === '1';
  const revokeIdentifier = req.body.revoke;
  const personalAccessTokens = req.personalAccessTokens;
  async.eachLimit(personalAccessTokens, 1, (pat, callback) => {
    if (revokeAll || pat.identifier === revokeIdentifier) {
      const replacement = Object.assign({}, pat._entity);
      replacement.active = false;
      delete replacement.PartitionKey;
      delete replacement.RowKey;
      delete replacement.Timestamp;
      return dc.replaceSetting(pat.PartitionKey, pat.RowKey, replacement, callback);
    }
    return callback();
  }, error => {
    return error ? next(error) : res.redirect('/settings/security/tokens');
  });
});

module.exports = router;
