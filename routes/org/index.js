//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

const express = require('express');
const router = express.Router();
const async = require('async');

const teamsRoute = require('./teams');
const reposRoute = require('./repos');
const membershipRoute = require('./membership');
const joinRoute = require('./join');
const leaveRoute = require('./leave');
const orgPermissions = require('../../middleware/github/orgPermissions');
const securityCheckRoute = require('./2fa');
const profileReviewRoute = require('./profileReview');
const approvalsSystem = require('../approvals');
const newRepoSpa = require('./newRepoSpa');
const peopleRoute = require('./people');

router.use(function (req, res, next) {
  var onboarding = req.query.onboarding;
  req.oss.addBreadcrumb(req, req.org.name, onboarding ? false : undefined);
  req.reposContext = {
    section: 'org',
    org: req.org,
  };
  next();
});

// Routes that do not require that the user be an org member
router.use('/join', joinRoute);
router.use('/repos', reposRoute);
router.use('/people', peopleRoute);
router.use('/teams', teamsRoute);

// Org membership requirement middleware
router.use(orgPermissions, (req, res, next) => {
  const organization = req.organization;
  const orgPermissions = req.orgPermissions;
  if (!orgPermissions) {
    return next(new Error('Organization permissions are unavailable'));
  }

  // Decorate the route for the sudoer
  if (orgPermissions.sudo) {
    req.sudoMode = true;
  }

  const membershipStatus = orgPermissions.membershipStatus;
  if (membershipStatus === 'active') {
    return next();
  } else {
    return res.redirect('/' + organization.name + '/join');
  }
});

// Org membership required endpoints:

router.get('/', function (req, res, next) {
  const operations = req.app.settings.providers.operations;
  var org = req.org;
  var oss = req.oss;
  var dc = req.app.settings.dataclient;
  async.parallel({
    organizationOverview: (callback) => {
      const uc = operations.getUserContext(oss.id.github);
      return uc.getAggregatedOrganizationOverview(org.name, callback);
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
      var teamsMaintained = results.organizationOverview.teams.maintainer;
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
router.use('/security-check', securityCheckRoute);
router.use('/profile-review', profileReviewRoute);
router.use('/approvals', approvalsSystem);
router.use('/new-repo', (req, res) => {
  res.redirect(req.org.baseUrl + 'wizard');
});
router.use('/wizard', newRepoSpa);

module.exports = router;
