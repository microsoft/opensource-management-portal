//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

var express = require('express');
var router = express.Router();
var async = require('async');
var utils = require('../../utils');

var teamsRoute = require('./teams');
var reposRoute = require('./repos');
var membershipRoute = require('./membership');
var joinRoute = require('./join');
var leaveRoute = require('./leave');
var securityCheckRoute = require('./2fa');
var profileReviewRoute = require('./profileReview');
var approvalsSystem = require('../approvals');
var requestRepo = require('./requestRepo');

router.use(function (req, res, next) {
    var onboarding = req.query.onboarding;
    req.org.oss.addBreadcrumb(req, req.org.name, onboarding ? false : undefined);
    next();
});

router.use('/join', joinRoute);

// Org membership requirement middleware

router.use(function (req, res, next) {
    var org = req.org;
    org.queryUserMembership(function (error, result) {
        if (result && result.state && result.state == 'active') {
            next();
        } else {
            res.redirect(org.baseUrl + 'join');
        }
    });
});

// Org membership required endppoints:

router.get('/', function (req, res, next) {
    var org = req.org;
    var oss = req.oss;
    var dc = req.app.settings.dataclient;
    async.parallel({
        teamsMaintained: function (callback) {
            org.getMyTeamMemberships('maintainer', callback);
        },
        userTeamMemberships: function (callback) {
            org.getMyTeamMemberships('all', callback);
        },
        isMembershipPublic: function (callback) {
            org.queryUserPublicMembership(callback);
        },
        orgUser: function (callback) {
            org.getDetails(function (error, details) {
                var userDetails = details ? org.oss.user(details.id, details) : null;
                callback(error, userDetails);
            });
        },
        /*
        CONSIDER: UPDATE ORG SUDOERS SYSTEM UI...
        isAdministrator: function (callback) {
            oss.isAdministrator(callback);
        }*/
    },
    function (error, results) {
        if (error) {
            return next(error);
        }
        if (results.isAdministrator && results.isAdministrator === true) {
            results.isSudoer = true;
        }
        var render = function (results) {
            oss.render(req, res, 'org/index', org.name, {
                accountInfo: results,
                org: org,
            });
        };
        // Check for pending approvals
        var teamsMaintained = results.teamsMaintained;
        if (teamsMaintained && teamsMaintained.length && teamsMaintained.length > 0) {
            var teamsMaintainedHash = {};
            for (var i = 0; i < teamsMaintained.length; i++) {
                teamsMaintainedHash[teamsMaintained[i].id] = teamsMaintained[i];
            }
            results.teamsMaintainedHash = teamsMaintainedHash;
            dc.getPendingApprovals(teamsMaintained, function (error, pendingApprovals) {
                if (!error && pendingApprovals) {
                    results.pendingApprovals = pendingApprovals;
                }
                render(results);
            });
        } else {
            render(results);
        }
    });
});

router.use('/membership', membershipRoute);
router.use('/leave', leaveRoute);
router.use('/teams', teamsRoute);
router.use('/repos', reposRoute);
router.use('/security-check', securityCheckRoute);
router.use('/profile-review', profileReviewRoute);
router.use('/approvals', approvalsSystem);
router.use('/new-repo', requestRepo);

module.exports = router;
