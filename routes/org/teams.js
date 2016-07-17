//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

var express = require('express');
var router = express.Router();
var async = require('async');
var utils = require('../../utils');

var teamRoute = require('./team/');

router.use(function (req, res, next) {
  req.org.oss.addBreadcrumb(req, 'Teams');
  next();
});

router.get('/', function (req, res, next) {
  var org = req.org;
  var onboardingOrJoining = req.query.joining || req.query.onboarding;
  async.parallel({
    allTeams: org.getTeams.bind(org),
    userTeams: org.getMyTeamMemberships.bind(org, 'all'),
    teamsMaintained: org.getMyTeamMemberships.bind(org, 'maintainer'),
    isAdministrator: function (callback) {
      org.isUserSudoer(function (ignored, isAdmin) {
        callback(null, isAdmin);
      });
    },
    orgUser: function (callback) {
      if (onboardingOrJoining) {
        org.getOrganizationUserProfile(callback);
      } else {
        callback();
      }
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
    org.oss.render(req, res, 'org/teams', 'Join a team', {
      availableTeams: r.allTeams,
      highlightedTeams: org.getHighlightedTeams(),
      org: org,
      isSudoer: r.isAdministrator === true,
      onboardingOrJoining: onboardingOrJoining,
      orgUser: r.orgUser,
      userTeamsMaintainedById: userTeamsMaintainedById,
      userIsMaintainer: userIsMaintainer,
    });
  });
});

router.use('/:teamname', function (req, res, next) {
  var org = req.org;
  var teamName = req.params.teamname;
  org.teamFromName(teamName, function (error, team) {
    if (error && error.slug) {
      return res.redirect(org.baseUrl + 'teams/' + error.slug);
    }
    if (!(team && team.id)) {
      if (!error) {
        error = new Error('No team named "' + teamName + '" could be found.');
        error.status = 404;
      } else {
        error = utils.wrapError('There was a problem querying for team information. The team may not exist.');
      }
      return next(error);
    }
    var teamId = team.id;
    var oss = org.oss;
    oss.getTeam(teamId, function (error, team) {
      if (error) {
        return next(error);
      }
      req.team = team;
      req.teamUrl = org.baseUrl + 'teams/' + team.slug + '/';
      req.org.oss.addBreadcrumb(req, team.name);
      next();
    });
  });
});

router.use('/:teamname', teamRoute);

module.exports = router;
