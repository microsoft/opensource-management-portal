//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

const express = require('express');
const router = express.Router();
const moment = require('moment');
const utils = require('../../utils');

router.get('/', function (req, res, next) {
  const organization = req.organization;
  const onboarding = req.query.onboarding;
  const joining = req.query.joining;
  req.legacyUserContext.addBreadcrumb(req, 'Multi-factor authentication check');
  const username = req.legacyUserContext.usernames.github;
  const cacheOptions = /* never use the cache */ {
    backgroundRefresh: false,
    maxAgeSeconds: -60,
  };
  organization.isMemberSingleFactor(username, cacheOptions, (error, state) => {
    if (error) {
      return next(utils.wrapError(error, `We were unable to validate your security settings with GitHub. The error GitHub gave us: ${error.message || error}`));
    }
    if (state === false && (req.body.validate || onboarding || joining)) {
      let url = organization.baseUrl;
      if (onboarding || joining) {
        let urlSegment = '?' + (onboarding ? 'onboarding' : 'joining') + '=' + (onboarding ? onboarding : joining);
        url = organization.baseUrl + (onboarding ? 'profile-review' : 'teams') + urlSegment;
      }
      return res.redirect(url);
    }
    const title = state === true ? 'Please enable two-factor authentication now' : 'Thanks for using modern security practices';
    req.legacyUserContext.render(req, res, 'org/2fa', title, {
      twoFactorOff: !state,
      notValidated: (req.query.validate ? true : undefined),
      onboarding: onboarding,
      organization: organization,
      nowString: moment().format('MMMM Do YYYY, h:mm:ss a'),
    });
  });
});

module.exports = router;
