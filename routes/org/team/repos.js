//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

var express = require('express');
var router = express.Router();
var utils = require('../../../utils');
var oneRepoRoute = require('./repo/');

router.use(function getTeamReposList(req, res, next) {
    var oss = req.oss;
    var team = req.team;
    req.teamReposUrl = req.teamUrl + 'repos/';
    oss.addBreadcrumb(req, 'Repositories');
    team.getRepos(function (error, repos) {
        if (error) {
            return next(error);
        }
        req.teamRepos = repos;
        next();
    });
});

router.get('/', function (req, res, next) {
  var team = req.team;
  req.oss.render(req, res, 'org/team/repos', team.name + ' - Team Repos', {
    team: team,
    repos: req.teamRepos,
    teamUrl: req.teamUrl,
  });
});

router.use('/:repoName/', function ensureOwnedTeam(req, res, next) {
    var repoName = req.params.repoName.toLowerCase();
    var repos = req.teamRepos;
    for (var i = 0; i < repos.length; i++) {
        if (repos[i] && repos[i].name && repos[i].name.toLowerCase() == repoName) {
            req.repo = repos[i];
            req.oss.addBreadcrumb(req, req.repo.name, false);
            return next();
        }
    }
    next(new Error('The repo "' + repoName + '" either does not exist or cannot be administered by this team.'));
});

router.use('/:repoName/', oneRepoRoute);

module.exports = router;
