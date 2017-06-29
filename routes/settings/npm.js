//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

const express = require('express');
const npmRegistryClient = require('npm-registry-client');
const router = express.Router();
const wrapError = require('../../utils').wrapError;

router.use((req, res, next) => {
  const link = req.link;
  if (link.npm) {
    req.npm = link.npm;
  }
  return next();
});

router.get('/', (req, res) => {
  req.legacyUserContext.render(req, res, 'settings/npm', 'NPM', {
    npm: req.npm,
  });
});

router.post('/', (req, res, next) => {
  let npmToken = req.body.token;
  if (!npmToken) {
    return next(new Error('Your NPM token must be provided'));
  }
  npmToken = npmToken.trim();

  const npm = new npmRegistryClient();
  const npmUri = 'https://registry.npmjs.org/npm';
  const npmCredentials = {
    token: npmToken,
  };
  const npmParameters = {
    timeout: 1000,
    auth: npmCredentials,
  };
  npm.whoami(npmUri, npmParameters, (error, username) => {
    if (error) {
      return next(wrapError(error, 'Your token could not be validated successfully. Please double-check it.'));
    }
    if (!username || typeof(username) !== 'string') {
      return next(new Error('The NPM registry did not return the expected type of information about your account.'));
    }
    // Save the username
    const link = req.link;
    link.npm = username;
    link.npmValidated = new Date();
    req.legacyUserContext.modernUser().updateLink(link, (error) => {
      if (error) {
        return next(error);
      }
      req.legacyUserContext.saveUserAlert(req, `Your NPM account, ${username}, has been validated and saved.`, 'NPM', 'success');
      req.legacyUserContext.invalidateLinkCache(() => {
        return res.redirect('/settings/npm');
      });
    });
  });
});

router.post('/clear', (req, res, next) => {
  const link = req.link;
  const linkAuthorizationsToDrop = ['npm', 'npmValidated'];
  linkAuthorizationsToDrop.forEach((property) => {
    delete link[property];
  });
  const dataClient = req.app.settings.providers.dataClient;
  const id = req.legacyUserContext.id.github;
  dataClient.updateLink(id, link, error => {
    if (error) {
      return next(error);
    }
    req.legacyUserContext.saveUserAlert(req, 'Your NPM information has been removed.', 'NPM', 'success');
    req.legacyUserContext.invalidateLinkCache(() => {
      return res.redirect('/settings/npm');
    });
  });
});

module.exports = router;
