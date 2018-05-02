//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

const express = require('express');
const router = express.Router();

const peopleSearch = require('./peopleSearch');
const systemWidePermissionsMiddleware = require('../middleware/github/systemWidePermissions');

router.use(function (req, res, next) {
  req.legacyUserContext.addBreadcrumb(req, 'People');
  req.reposContext = {
    section: 'people',
    pivotDirectlyToOtherOrg: '/people/', // hack
  };
  next();
});

// Campaign-related redirect to take the user to GitHub
router.get('/github/:login', (req, res, next) => {
  if (!req.app.settings.providers || !req.app.settings.providers.campaign) {
    return next();
  }
  return req.app.settings.providers.campaign.redirectGitHubMiddleware(req, res, next, () => {
    const login = req.params.login;
    return login ? login : null;
  });
});


router.use(systemWidePermissionsMiddleware);

router.use(peopleSearch);

module.exports = router;
