//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

import express = require('express');
import { ReposAppRequest } from '../../transitional';
const router = express.Router();

interface IUserProfileWarnings {
  company?: string;
  email?: string;
}

router.get('/', function (req: ReposAppRequest, res, next) {
  const organization = req.organization;
  const operations = req.app.settings.operations;
  const config = operations.config;
  const onboarding = req.query.onboarding;
  const login = req.individualContext.getGitHubIdentity().username;
  operations.getAccountByUsername(login, (getAccountError, detailed) => {
    if (getAccountError) {
      return next(getAccountError);
    }
    const userProfileWarnings: IUserProfileWarnings = {};
    if (!detailed.company || (detailed.company && detailed.company.toLowerCase().indexOf(config.brand.companyName.toLowerCase()) < 0)) {
      userProfileWarnings.company = 'color:red';
    }
    if (!detailed.email || (detailed.email && detailed.email.toLowerCase().indexOf(config.brand.companyName.toLowerCase()) < 0)) {
      userProfileWarnings.email = 'color:red';
    }
    req.individualContext.webContext.render({
      view: 'org/profileReview',
      title: 'Your GitHub Profile',
      state: {
        organization: organization,
        userProfile: detailed,
        userProfileWarnings: userProfileWarnings,
        theirUsername: req.individualContext.getGitHubIdentity().username,
        onboarding: onboarding,
        showBreadcrumbs: onboarding === undefined,
      },
    });
  });
});

module.exports = router;
