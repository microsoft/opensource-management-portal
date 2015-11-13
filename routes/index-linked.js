//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

var express = require('express');
var router = express.Router();
var async = require('async');
var moment = require('moment');
var utils = require('../utils');
var OpenSourceUserContext = require('../oss');

var orgsRoute = require('./orgs');
var orgAdmin = require('./orgAdmin');
var approvalsSystem = require('./approvals');
var linkRoute = require('./link');
var unlinkRoute = require('./unlink');
var legacyRoute = require('./legacy');

//-----------------------------------------------------------------------------
//-----------------------------------------------------------------------------
// SECURITY ROUTE MARKER:
// Below this next call, all routes will require an active link to exist for 
// the authenticated GitHub user.
//-----------------------------------------------------------------------------
//-----------------------------------------------------------------------------
router.use(function (req, res, next) {
    var link = req.oss.entities.link;
    if (link && link.ghu) {
        next();
    } else {
        var error = new Error('Not found (not a corporate authenticated user).');
        error.status = 404;
        error.originalUrl = req.originalUrl;
        error.skipLog = true;
        error.detailed = 'You are not currently signed in as a user with a "linked" corporate identity, FYI.';
        next(error);
    }
});
// end security route
//-----------------------------------------------------------------------------
//-----------------------------------------------------------------------------

router.use('/unlink', unlinkRoute);

router.get('/teams', function (req, res, next) {
    var oss = req.oss;
    var i;
    oss.addBreadcrumb(req, 'All Teams');
    async.parallel({
        allTeams: oss.getAllOrganizationsTeams.bind(oss),
        userTeams: oss.getMyTeamMemberships.bind(oss, 'all'),
        }, function (error, r) {
            if (error) {
                return next(error);
            }
            var highlightedTeams = [];
            var orgs = oss.orgs();
            for (i = 0; i < orgs.length; i++) {
                var highlighted = orgs[i].getHighlightedTeams();
                for (var j = 0; j < highlighted.length; j++) {
                    highlightedTeams.push(highlighted[j]);
                }
            }
            var userTeamsById = {};
            for (i = 0; i < r.userTeams.length; i++) {
                userTeamsById[r.userTeams[i].id] = true;
            }
            for (i = 0; i < r.allTeams.length; i++) {
                r.allTeams[i]._hack_isMember = userTeamsById[r.allTeams[i].id] ? true : false;
            }
            oss.render(req, res, 'org/teams', 'Teams', {
                availableTeams: r.allTeams,
                highlightedTeams: highlightedTeams,
            });
        });
});

router.use('/organization', orgAdmin);
router.use('/approvals', approvalsSystem);
router.use(legacyRoute);
router.use('/', orgsRoute);

module.exports = router;
