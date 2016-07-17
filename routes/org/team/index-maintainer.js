//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

var express = require('express');
var router = express.Router();
var async = require('async');
var utils = require('../../../utils');

var teamReposRoute = require('./repos');
var approvalsRoute = require('./approvals');
var membersRoute = require('./members');
var maintainersRoute = require('./maintainers');

// auth for maintainers and sudo admins only

router.use(function (req, res, next) {
  var team = req.team;
  var oss = team.oss;
  team.org.isUserSudoer(function (ignored, isAdmin) {
    // We look the team up first and THEN verify using admin
    // so that we don't scare users away with their sudo rights
    team.getOfficialMaintainers(function (error, maintainers) {
      if (error) {
        return next(error);
      }
      for (var i = 0; i < maintainers.length; i++) {
        if (maintainers[i].id == oss.id.github) {
          return next();
        }
      }
      if (isAdmin === true) {
        req.sudoMode = true;
        return next();
      }
      var err = new Error('You do not have permission to maintain this team.');
      err.detailed = 'These aren\'t the droids you are looking for.';
      err.status = 403;
      err.fancyLink = {
        link: req.teamUrl + 'join',
        title: 'Request to join this team',
      };
      err.skipLog = true;
      next(err);
    });
  });
});

router.get('/', function (req, res, next) {
  var oss = req.oss;
  var team = req.team;
  var dc = oss.dataClient();
  async.parallel({
    employees: function (callback) {
      dc.getAllEmployees(callback);
    },
    maintainers: function (callback) {
      team.getMaintainers(function (error, maintainers) {
        if (error) {
          return callback(error);
        }
        if (maintainers && maintainers.length && maintainers.length > 0) {
          oss.getLinksForUsers(maintainers, function (/* errorIgnore */) {
            async.each(maintainers, function (mt, cb) {
              mt.getDetailsByUsername(function (/* errorIgnoreEx */) {
                cb(null);
              });
            }, function () {
              callback(null, maintainers);
            });
          });
        } else {
          callback(null, []);
        }
      });
    },
    pendingApprovals: function (callback) {
      team.getApprovals(callback);
    },
  }, function (error, data) {
    if (error) {
      return next(error);
    }
    oss.render(req, res, 'org/team/index', team.name + ' in ' + team.org.name, {
      team: team,
      teamUrl: req.teamUrl,
      maintainers: data.maintainers,
      employees: data.employees,
      pendingApprovals: data.pendingApprovals,
    });
  });
});

router.post('/delete', function (req, res, next) {
  var team = req.team;
  team.delete(function (error) {
    if (error) {
      return next(error);
    }
    req.oss.saveUserAlert(req, 'Team deleted.', 'Delete', 'success');
    res.redirect(req.org ? req.org.baseUrl : '/');
  });
});

router.get('/delete', function (req, res) {
  var oss = req.oss;
  var team = req.team;
  oss.addBreadcrumb(req, 'Team Delete');
  oss.render(req, res, 'org/team/deleteTeamConfirmation', team.name + ' - Delete GitHub team', {
    team: team,
    teamUrl: req.teamUrl,
  });
});

router.use('/repos', teamReposRoute);
router.use('/approvals', approvalsRoute);
router.use('/members', membersRoute);
router.use('/maintainers', maintainersRoute);

router.get('/properties', function (req, res, next) {
  var oss = req.oss;
  var team = req.team;
  team.getDetails(function (error) {
    if (error) {
      return next(utils.wrapError(error, 'Had trouble getting the detailed properties for this team.'));
    }
    var dc = oss.dataClient();
    dc.getAllEmployees(function (error, employees) {
      if (error) {
        return next(error);
      }
      oss.addBreadcrumb(req, 'Properties');
      oss.render(req, res, 'org/team/properties', team.name + ' - Properties', {
        team: team,
        employees: employees,
        teamUrl: req.teamUrl,
      });
    });
  });
});

router.post('/properties', function (req, res, next) {
  var team = req.team;
  var oldName = team.name;
  var patchObject = {
    name: req.body.ghname,
    description: req.body.description,
  };
  team.update(patchObject, function (error) {
    if (error) {
      return next(error);
    }
    req.oss.saveUserAlert(req, 'Team properties updated on GitHub.', 'Properties Saved', 'success');
    var url = req.teamUrl;
    if (oldName !== patchObject.name) {
      url = team.org.baseUrl + 'teams/';
    }
    res.redirect(url);
  });
});

module.exports = router;
