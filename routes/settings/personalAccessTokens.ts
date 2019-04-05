//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

import async = require('async');
const crypto = require('crypto');
import express = require('express');
import { IRequestForSettingsPersonalAccessTokens, IReposError, IResponseForSettingsPersonalAccessTokens, ReposAppRequest } from '../../transitional';

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

function getPersonalAccessTokens(req: ReposAppRequest, res, next) {
  const dc = req.app.settings.dataclient;
  const aadId = req.individualContext.corporateIdentity.id;
  dc.getSettingByProperty(settingType, 'owner', aadId, (error, personalAccessTokens) => {
    if (error) {
      return next(error);
    }
    req['personalAccessTokens'] = translateTableToEntities(personalAccessTokens);
    return next();
  });
}

function view(req, res) {
  const personalAccessTokens = req.personalAccessTokens;
  req.individualContext.webContext.render({
    view: 'settings/personalAccessTokens',
    title: 'Personal access tokens',
    state: {
      personalAccessTokens: personalAccessTokens,
      newKey: res.newKey,
      isPreviewUser: true, //req.isPreviewUser,
    },
  });
}

router.use(getPersonalAccessTokens);

router.get('/', view);

router.get('/extension', (req: IRequestForSettingsPersonalAccessTokens, res: IResponseForSettingsPersonalAccessTokens) => {
  const personalAccessTokens = req.personalAccessTokens;
  req.individualContext.webContext.render({
    view: 'settings/extension',
    title: 'Install the browser extension (preview)',
    state: {
      personalAccessTokens: personalAccessTokens,
      newKey: res.newKey,
      newTokenDescription: 'Extension ' + (new Date()).toDateString(),
    },
  });
});

function createToken(req: ReposAppRequest, res, next) {
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
  const aadId = req.individualContext.corporateIdentity.id;
  const rowKey = `${partitionKey}${hash}`;

  insights.trackEvent({
    name: 'ReposCreateTokenStart',
    properties: {
      id: aadId,
      description: description,
    },
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
      insights.trackEvent({
        name: 'ReposCreateTokenFailure',
        properties: {
          id: aadId,
          description: description,
        },
      });
      return next(insertError);
    }

    getPersonalAccessTokens(req, res, () => {
      insights.trackEvent({
        name: 'ReposCreateTokenFinish',
        properties: {
          id: aadId,
          description: description,
        },
      });

      res.newKey = newKey;
      return view(req, res);
    });
  });
}

router.post('/create', createToken);
router.post('/extension', createToken);

router.post('/delete', (req: IRequestForSettingsPersonalAccessTokens, res, next) => {
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
