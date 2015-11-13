//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

var express = require('express');
var router = express.Router();
var utils = require('../utils');

// This file helps manage URI changes that happened in October 2015.
// Not necessary for new instances of the portal.

router.use('/account/jointeams', function (req, res, next) {
    res.redirect('/teams');
});

router.use('/team/:teamid', function (req, res, next) {
    var oss = req.oss;
    var teamid = req.params.teamid;
    oss.getTeam(teamid, function (error, team) {
        if (error) {
            var err = utils.wrapError(error, 'Team not found.', true);
            err.status = 404;
            return next(err);
        }
        req.team = team;
        next();
    });
});

router.get('/team/:teamid/approvals/:approvalid', function (req, res, next) {
    var team = req.team;
    res.redirect(team.org.baseUrl + 'teams/' + team.slug + '/approvals/' + req.params.approvalid);
});

router.get('/account/approvals/:approvalid', function (req, res, next) {
    res.redirect('/approvals/' + req.params.approvalid);
});

router.get('/team/:teamid', function (req, res, next) {
    var team = req.team;
    res.redirect(team.org.baseUrl + 'teams/' + team.slug);
});

module.exports = router;
