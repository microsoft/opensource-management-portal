//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

var express = require('express');
var router = express.Router();
var async = require('async');
var utils = require('../../../utils');

router.get('/', function (req, res, next) {
  var team = req.team;
  var oss = req.oss;
  var dc = oss.dataClient();
  async.parallel({
    employees: function (callback) {
      dc.getAllEmployees(callback);
    },
    members: function (callback) {
      team.getMemberLinks(callback);
    },
  }, function (error, data) {
    if (error) {
      return next(error);
    }
    oss.addBreadcrumb(req, 'Members');
    oss.render(req, res, 'org/team/members', team.name + ' - Team Membership', {
      team: team,
      teamUrl: req.teamUrl,
      employees: data.employees,
      teamMembers: data.members,
    });
  });
});

router.get('/securityCheck', function (req, res, next) {
  var team = req.team;
  // This one is a little convoluted as the app has been refactored...
  var teamMembers = null;
  var usersNotInCompliance = [];
  async.waterfall([
    function (callback) {
      team.getDetails(callback);
    },
    function (details, callback) {
      team.getMemberLinks(callback);
    },
    function (memberLinks, callback) {
      teamMembers = memberLinks;
      // Now, get the org-wide audit list..
      team.org.getAuditList(callback);
    },
    function (naughtyUsers, callback) {
      for (var i = 0; i < teamMembers.length; i++) {
        var login = teamMembers[i].login;
        if (naughtyUsers[login]) {
          usersNotInCompliance.push(teamMembers[i]);
        }
      }
      callback(null, usersNotInCompliance);
    },
  ], function (error, naughtyUsers) {
    if (error) {
      return next(error);
    }
    var oss = team.oss;
    oss.addBreadcrumb(req, 'Security Check');
    oss.render(req, res, 'org/team/securityCheck', team.name + ' - Team Security Check', {
      team: team,
      teamUrl: req.teamUrl,
      noncompliantUsers: naughtyUsers,
    });
  });
});
router.get('/:memberUsername/remove', function (req, res, next) {
  var team = req.team;
  var oss = req.oss;
  var dc = req.app.settings.dataclient;
  var removeUsername = req.params.memberUsername;
  if (!removeUsername || (removeUsername.length && removeUsername.length === 0)) {
    return next(new Error('A username must be provided.'));
  }
  // CONSIDER: NEED TO SUPPORT FOR ALL ORGANIZATIONS!
  oss.addBreadcrumb(req, 'Remove ' + removeUsername);
  dc.getUserLinkByUsername(removeUsername, function (error, link) {
    // Note: an error is ok here; if there is an error, we still show the page, as 
    // this is likely a user added directly by a GitHub administrator for the 
    // organization instead of through the portal/tooling. We want to make sure 
    // the user will still be removable.
    oss.render(req, res, 'org/team/removeMemberConfirmation', team.name + ' - Remove User', {
      userInformation: dc.reduceEntity(link),
      removeUsername: removeUsername,
      team: team,
      teamUrl: req.teamUrl,
    });
  });
});

// Remove a member by GitHub username (body field name: removeUsername)
router.post('/:memberUsername/remove', function (req, res, next) {
  var removeUsername = req.params.memberUsername;
  var team = req.team;
  if (team.org === undefined) {
    return next(new Error('Org undefined.'));
  }
  var dc = req.app.settings.dataclient;
  if (!removeUsername || (removeUsername.length && removeUsername.length === 0)) {
    return next(new Error('A username must be provided.'));
  }
  dc.getUserLinkByUsername(removeUsername, function (error, link) {
    if (req.body.removeFromTeam !== undefined) {
      return team.removeMembership(removeUsername, function (error) {
        if (error) {
          return next(new Error('Removing the user from your team failed.'));
        }
        req.oss.saveUserAlert(req, removeUsername + ' has been removed from the team ' + team.name + '.', 'Team Member Remove', 'success');
        return res.redirect(req.teamUrl + 'members');
      });
    }
    // More intrusive all-org, plus link move...
    var org1 = team.org;
    var entity = null;
    if (link) {
      entity = dc.reduceEntity(link);
    }
    // CONSIDER: NEED TO SUPPORT FOR ALL ORGANIZATIONS!
    org1.removeUserMembership(removeUsername, function (error) {
      if (error) {
        return next(new Error('Removing the entire user failed. Please report this to the organization administrators to make sure the removal happens completely.'));
      }
      req.oss.saveUserAlert(req, removeUsername + ' has been removed from ' + org1.name + '.', 'Member Remove from Organization', 'success');
      if (entity && entity.ghu) {
        return dc.removeLink(entity.ghid, function (error) {
          if (error) {
            return next(new Error('Although the user was removed from the organization and is no longer able to access the site, a failure happened trying to remove the user from the portal system. If you could reach out to the administrators to hunt down this issue, that would be great. Thanks. Please include the GitHub username of the user, ' + removeUsername));
          }
          req.oss.saveUserAlert(req, removeUsername + ' has been removed from the corporate GitHub system.', 'Member Remove from the company', 'success');
          res.redirect(req.teamUrl + 'members');
        });
      }
      return res.redirect(req.teamUrl + 'members');
    });
  });
});

router.post('/add', function (req, res, next) {
  var team = req.team;
  var dc = req.app.settings.dataclient;
  var newMemberId = req.body.addMember;
  team.getMembersCached('all', function (error, members) {
    if (error) {
      return next(new Error('Team information not found.'));
    }
    for (var member in members) {
      var m = members[member];
      if (m.ghid && m.ghid == newMemberId) {
        return next(utils.wrapError(null, 'This person is already a member of the team.', true));
      }
    }
    dc.getUserLinks([newMemberId], function (error, links) {
      if (!error && links && links.length > 0 && links[0] && links[0].ghu) {
        team.addMembership('member', links[0].ghu, function (error) {
          if (!error) {
            req.oss.saveUserAlert(req, 'Added "' + links[0].ghu + '" to the team.', 'Member Added', 'success');
          }
          return error ?
            next(new Error('The GitHub API returned an error, they may be under attack or currently having system problems. This tool is dependent on their system being available in real-time, sorry.')) :
            res.redirect(req.teamUrl + 'members');
        });
      } else {
        return next(new Error('We had trouble finding the official identity link information about this user. Please report this to the admins.'));
      }
    });
  });
});

module.exports = router;
