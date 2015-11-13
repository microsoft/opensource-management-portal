//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

var express = require('express');
var router = express.Router();
var async = require('async');
var utils = require('../../utils');

router.get('/', function (req, res, next) {
    var org = req.org;
    var onboarding = req.query.onboarding;
    org.oss.modernUser().getDetailsByUsername(function () {
        var detailed = org.oss.modernUser();
        var userProfileWarnings = {};
        if (!detailed.company || (detailed.company && detailed.company.toLowerCase().indexOf(org.oss.setting('companyName').toLowerCase()) < 0)) {
            userProfileWarnings.company = 'color:red';
        }
        if (!detailed.email || (detailed.email && detailed.email.toLowerCase().indexOf(org.oss.setting('companyName').toLowerCase()) < 0)) {
            userProfileWarnings.email = 'color:red';
        }
        req.oss.render(req, res, 'org/profileReview', 'Your GitHub Profile', {
            org: org,
            userProfile: detailed,
            userProfileWarnings: userProfileWarnings,
            theirUsername: req.oss.usernames.github,
            onboarding: onboarding,
            showBreadcrumbs: onboarding === undefined,
        });
    });
});

module.exports = router;
