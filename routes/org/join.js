//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

var express = require('express');
var router = express.Router();
var utils = require('../../utils');

router.use(function (req, res, next) {
    var org = req.org;
    var err = null;
    if (org.setting('locked')) {
        err = new Error('This organization is locked to new members.');
        err.detailed = 'At this time, the maintainers of the "' + org.name + '" organization have decided to not enable onboarding through this portal.';
        err.skipLog = true;
    }
    next(err);
});

router.get('/', function (req, res, next) {
    var org = req.org;
    var onboarding = req.query.onboarding;
    org.queryUserMembership(false /* do not allow caching */, function (error, result) {
        var state = result && result.state ? result.state : false;
        var clearAuditListAndRedirect = function () {
            org.clearAuditList(function () {
                var url = org.baseUrl + 'security-check' + (onboarding ? '?onboarding=' + onboarding : '?joining=' + org.name);
                res.redirect(url);
            });
        };
        var showPage = function () {
            org.getDetails(function (error, details) {
                if (error) {
                    return next(error);
                }
                var userDetails = details ? org.oss.user(details.id, details) : null;
                var title = org.name +  ' Organization Membership ' + (state == 'pending' ? 'Pending' : 'Join');
                req.oss.render(req, res, 'org/pending', title, {
                    result: result,
                    state: state,
                    org: org,
                    orgUser: userDetails,
                    onboarding: onboarding,
                });
            });
        };
        if (state == 'active') {
            clearAuditListAndRedirect();
        } else if (state == 'pending' && req.user.github.increasedScope) {
            var userToken = req.user.github.increasedScope.github.accessToken;
            org.acceptOrganizationInvitation(userToken, function (error, updatedState) {
                if (error) {
                    if (error.statusCode == 401) {
                        req.session.referer = req.originalUrl;
                        return res.redirect('/auth/github/increased-scope');
                    }
                    // We do not error out, they can still fall back on the
                    // manual acceptance system that the page will render.
                    // CONSIDER: Log this error anyway for investigation...
                }
                if (!error && updatedState && updatedState.state === 'active') {
                    return clearAuditListAndRedirect();
                }
                showPage();
            });
        } else {
            showPage();
        }
    });
});

router.get('/express', function (req, res, next) {
    var org = req.org;
    var onboarding = req.query.onboarding;
    org.queryUserMembership(false /* do not allow caching */, function (error, result) {
        var state = result && result.state ? result.state : false;
        if (state == 'active'|| state == 'pending') {
            res.redirect(org.baseUrl + 'join' + (onboarding ? '?onboarding=' + onboarding : '?joining=' + org.name));
        } else if (req.user.github.increasedScope && req.user.github.increasedScope.github && req.user.github.increasedScope.github.accessToken) {
            joinOrg(req, res, next);
        } else {
            req.session.referer = req.originalUrl;
            res.redirect('/auth/github/increased-scope');
        }
    });
});

function joinOrg(req, res, next) {
    var org = req.org;
    var onboarding = req.query.onboarding;
    var everyoneTeam = org.getAllMembersTeam();
    everyoneTeam.addMembership('member', function (error) {
        if (error) {
            return next(utils.wrapError(error, 'We had trouble sending you an invitation through GitHub to join the ' + org.name + ' organization. Please try again later. If you continue to receive this message, please reach out for us to investigate.'));
        }
        res.redirect(org.baseUrl + 'join' + (onboarding ? '?onboarding=' + onboarding : '?joining=' + org.name));
    });
}

router.post('/', joinOrg);

module.exports = router;
