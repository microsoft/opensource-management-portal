//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

const express = require('express');
const router = express.Router();

router.get('/', function (req, res, next) {
  const organization = req.organization;
  const operations = req.app.settings.operations;
  const config = operations.config;
  const onboarding = req.query.onboarding;
  const context = req.legacyUserContext;
  const login = context.usernames.github;
  operations.getAccountByUsername(login, (getAccountError, detailed) => {
    if (getAccountError) {
      return next(getAccountError);
    }
    const userProfileWarnings = {};
    if (!detailed.company || (detailed.company && detailed.company.toLowerCase().indexOf(config.brand.companyName.toLowerCase()) < 0)) {
      userProfileWarnings.company = 'color:red';
    }
    if (!detailed.email || (detailed.email && detailed.email.toLowerCase().indexOf(config.brand.companyName.toLowerCase()) < 0)) {
      userProfileWarnings.email = 'color:red';
    }
    req.legacyUserContext.render(req, res, 'org/profileReview', 'Your GitHub Profile', {
      organization: organization,
      userProfile: detailed,
      userProfileWarnings: userProfileWarnings,
      theirUsername: context.usernames.github,
      onboarding: onboarding,
      showBreadcrumbs: onboarding === undefined,
    });
  });
});

module.exports = router;
