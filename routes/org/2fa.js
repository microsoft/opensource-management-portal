//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

const express = require('express');
const router = express.Router();
const moment = require('moment');
const utils = require('../../utils');

router.get('/', function (req, res, next) {
  var org = req.org;
  var onboarding = req.query.onboarding;
  var joining = req.query.joining;
  org.oss.addBreadcrumb(req, 'Multi-factor authentication check');
  org.queryUserMultifactorStateOk(function (error, state) {
    if (error) {
      return next(utils.wrapError(error, 'A problem occurred while trying to query important compliance information regarding your account.'));
    }
    if (state === true && (req.body.validate || onboarding || joining)) {
      var url = org.baseUrl;
      if (onboarding || joining) {
        var urlSegment = '?' + (onboarding ? 'onboarding' : 'joining') + '=' + (onboarding ? onboarding : joining);
        url = org.baseUrl +
          (onboarding ? 'profile-review' : 'teams') +
          urlSegment;
      }
      return res.redirect(url);
    }
    var title = state === false ? 'Please enable two-factor authentication now' : 'Thanks for using modern security practices';
    req.oss.render(req, res, 'org/2fa', title, {
      twoFactorOff: !state,
      notValidated: (req.query.validate ? true : undefined),
      onboarding: onboarding,
      org: org,
      nowString: moment().format('MMMM Do YYYY, h:mm:ss a'),
    });
  });
});

module.exports = router;
