//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

var express = require('express');
var router = express.Router();
var async = require('async');
var utils = require('../../utils');

var repoRoute = require('./repo/');

router.use(function (req, res, next) {
    req.org.oss.addBreadcrumb(req, 'Repositories');
    next();
});

// December 2015 note:
//
// This is an early implementation of a "repo"-centric view of the organization.
//
// The initial goal is to simply help people find the team(s) and permissions for
// a repo, but in time it might make sense to offer more visibility here: team
// maintainers could take repos public and manage collaborators directly, etc.

router.get('/', function (req, res, next) {
    var org = req.org;
    org.getRepos(function (error, repos) {
        if (error) {
            return next(error);
        }
        async.sortBy(repos, function (entry, cb) {
            cb(null, entry.name);
        }, function (error, sorted) {
            org.oss.render(req, res, 'org/repos', 'All Organization Source Repositories', {
                repos: sorted,
                org: org,
            });
        });
    });
});

router.use('/:reponame', function (req, res, next) {
    var org = req.org;
    var repoName = req.params.reponame;
    var repo = org.repo(repoName);
    repo.getDetails(function (error) {
        if (error) {
            return next(error);
        }
        req.repo = repo;
        req.repoName = repoName;
        req.repoUrl = org.baseUrl + 'repos/' + repo.name + '/';
        req.org.oss.addBreadcrumb(req, repo.name);
        next();
    });
/*    
            if (!error) {
                error = new Error('No team named "' + teamName + "' could be found.");
                error.status = 404;
            } else {
                error = utils.wrapError('There was a problem querying for team information. The team may not exist.');
            }
            return next(error);
        }
        */
});

router.use('/:reponame', repoRoute);

module.exports = router;
