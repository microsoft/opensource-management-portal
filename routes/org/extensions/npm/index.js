//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

const express = require('express');
const router = express.Router();

const npmPublish = require('../../../../lib/npm/publish');
const requireLink = require('../../../../middleware/links/');

router.use(requireLink, (req, res, next) => {
  const repository = req.repository;
  repository.getBranches((error, branches) => {
    if (error) {
      return next(error);
    }
    req.repoBranches = branches;
    repository.getDetails(() => {
      return next();
    });
  });
});

router.get('/', (req, res) => {
  renderForm(req, res);
});

function renderForm(req, res, userChoiceError) {
  const branches = req.repoBranches;
  const link = req.link;
  const npmUsername = link.npm;
  const repository = req.repository;
  const organization = req.organization;
  req.legacyUserContext.render(req, res, 'extensions/npm/publish', 'NPM publishing', {
    organization: organization,
    repository: repository,
    branches: branches,
    npmUsername: npmUsername,
    userChoiceError: userChoiceError,
  });
}

router.post('/publish', (req, res, next) => {
  const repository = req.repository;
  const organization = req.organization;
  const upn = req.legacyUserContext.modernUser().contactEmail();
  const collaborators = req.body.collaborators;
  const options = {
    operations: req.app.settings.providers.operations,
    npm: {
      username: req.link.npm,
    },
    upn: upn,
    basedir: req.app.settings.basedir,
    clone: `https://github.com/${repository.full_name}.git`,
    branch: req.body.branch || 'master',
    collaborators: collaborators ? collaborators.split(',') : [],
  };
  if (req.body.acknowledge) {
    options.ignorePublishScripts = true;
  }
  npmPublish(options).then(success => {
    return req.legacyUserContext.render(req, res, 'extensions/npm/published', 'Published', {
      organization: organization,
      repository: repository,
      log: success.log,
      context: success,
    });
  }, failure => {
    if (failure.userChoice) {
      return renderForm(req, res, failure);
    }
    return next(failure);
  });
});

module.exports = router;
