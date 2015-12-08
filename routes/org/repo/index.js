//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

var express = require('express');
var router = express.Router();
var async = require('async');
var utils = require('../../../utils');

router.get('/teams', function (req, res, next) {
    var repo = req.repo;
    var org = repo.org;
    async.parallel({
        allTeams: repo.teams.bind(repo),
        userTeams: org.getMyTeamMemberships.bind(org, 'all'),
        teamsMaintained: org.getMyTeamMemberships.bind(org, 'maintainer'),
        isAdministrator: function (callback) {
            org.isUserSudoer(function (ignored, isAdmin) {
                callback(null, isAdmin);
            });
        },
    }, function (error, r) {
        var i = 0;
        if (error) {
            return next(error);
        }
        var userTeamsMaintainedById = {};
        var userIsMaintainer = false;
        if (r.teamsMaintained && r.teamsMaintained.length && r.teamsMaintained.length > 0) {
            userTeamsMaintainedById = utils.arrayToHashById(r.teamsMaintained);
            userIsMaintainer = true;
        }
        var userTeamsById = {};
        for (i = 0; i < r.userTeams.length; i++) {
            userTeamsById[r.userTeams[i].id] = true;
        }
        for (i = 0; i < r.allTeams.length; i++) {
            r.allTeams[i]._hack_isMember = userTeamsById[r.allTeams[i].id] ? true : false;
        }
        // Sort the list by the permission type and then by the name
        async.sortBy(r.allTeams, function (entry, cb) {
            cb(null, entry.permission + ':' + entry.name);
        }, function (error, sorted) {
            req.oss.render(req, res, 'org/repo/teams', 'Teams the help manage "' + repo.name + '"', {
                teams: sorted,
                repo: repo,
                isSudoer: r.isAdministrator === true,
                org: org,
                userTeamsMaintainedById: userTeamsMaintainedById,
            });
        });
    });
});

module.exports = router;
