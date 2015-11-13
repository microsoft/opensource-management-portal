//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

var express = require('express');
var router = express.Router();
var async = require('async');
var utils = require('../../utils');

router.get('/', function (req, res, next) {
    var org = req.org ? req.org : req.oss.org();
    var onboarding = req.query.onboarding;
    var joining = req.query.joining;
    org.queryUserPublicMembership(function (error, result) {
        var publicMembership = result === true;
        org.oss.addBreadcrumb(req, 'Membership Visibility');
        var teamPostfix = '';
        if (onboarding || joining) {
            teamPostfix = '?' + (onboarding ? 'onboarding' : 'joining') + '=' + (onboarding || joining);
        }
        req.oss.render(req, res, 'org/publicMembershipStatus', org.name + ' Membership Visibility', {
            org: org,
            publicMembership: publicMembership,
            theirUsername: req.oss.usernames.github,
            onboarding: onboarding,
            joining: joining,
            teamPostfix: teamPostfix,
            showBreadcrumbs: onboarding === undefined,
        });
    });
});

router.post('/', function (req, res, next) {
    var user = req.user;
    var onboarding = req.query.onboarding;
    var joining = req.query.joining;
    if (user && user.github && user.github.increasedScope && user.github.increasedScope.github && user.github.increasedScope.github.accessToken) {
        var org = req.org ? req.org : req.oss.org();
        var message1 = req.body.conceal ? 'concealing' : 'publicizing';
        var message2 = req.body.conceal ? 'hidden' : 'public, thanks for your support';
        org[req.body.conceal ? 'setPrivateMembership' : 'setPublicMembership'].call(org, user.github.increasedScope.github.accessToken, function (error) {
            if (error) {
                return next(utils.wrapError(error, 'We had trouble ' + message1 + ' your membership. Did you authorize the increased scope of access with GitHub?'));
            }
            req.oss.saveUserAlert(req, 'Your ' + org.name + ' membership is now ' + message2 + '!', org.name, 'success');
            var url = org.baseUrl + ((onboarding || joining) ? '/teams' : '');
            var extraUrl = (onboarding || joining) ? '?' + (onboarding ? 'onboarding' : 'joining') + '=' + (onboarding || joining) : '';
            res.redirect(url + extraUrl);
        });
    } else {
        return next(new Error('The increased scope to write the membership to GitHub was not found in your session. Please report this error.'));
    }
});

module.exports = router;
