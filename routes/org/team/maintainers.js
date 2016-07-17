//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

const express = require('express');
const router = express.Router();

router.get('/:maintainerid/downgrade', function (req, res, next) {
  var team = req.team;
  var dc = req.app.settings.dataclient;
  var maintainerid = req.params.maintainerid;
  var oss = req.oss;
  dc.getLink(maintainerid, function (error, person) {
    if (error) {
      return next(error);
    }
    person = dc.reduceEntity(person);
    oss.addBreadcrumb(req, 'Downgrade ' + person.ghu);
    oss.render(req, res, 'org/team/maintainers/deleteConfirmation', team.name + ' - Downgrade user to a member from a maintainer?', {
      team: team,
      teamUrl: req.teamUrl,
      maintainer: person,
    });
  });
});

router.post('/:maintainerid/downgrade', function (req, res, next) {
  var team = req.team;
  var dc = req.app.settings.dataclient;
  dc.getLink(req.params.maintainerid, function (error, link) {
    if (error) {
      return next(error);
    }
    var username = link.ghu._;
    team.addMembership('member', username, function (error) {
      if (error) {
        return next(error);
      }
      req.oss.saveUserAlert(req, 'Downgraded "' + username + '" to a standard user.', 'User permission downgraded', 'success');
      res.redirect(req.teamUrl);
    });
  });
});

router.post('/add', function (req, res, next) {
  var team = req.team;
  var oss = req.oss;
  var id = req.body.maintainer2;
  var newMaintainer = oss.user(id);
  newMaintainer.getLinkRequired(function (error, link) {
    if (error) {
      return next(error);
    }
    if (link.ghu === undefined) {
      return next(new Error('No username.'));
    }
    team.addMembership('maintainer', link.ghu, function (error) {
      if (error) {
        return next(error);
      }
      req.oss.saveUserAlert(req, 'Added "' + link.ghu + '" as a Team Maintainer. They now have the same permission level of access that you have.', 'Team Maintainer Added', 'success');
      res.redirect(req.teamUrl);
    });
  });
});

router.get('/downgradeSelf', function (req, res, next) {
  var team = req.team;
  // NOTE: This path does not actually verify. You've been warned!
  // Remove the current user as a team maintainer.
  team.addMembership('member', req.oss.entities.link.ghu, function (error) {
    if (error) {
      return next(error);
    }
    req.oss.saveUserAlert(req, 'You\'ve downgraded yourself!', 'Dropping yourself as a team maintainer', 'success');
    res.redirect('/');
  });
});

router.get('/transfer', function (req, res, next) {
  var oss = req.oss;
  var team = req.team;
  var dc = req.app.settings.dataclient;
  dc.getAllEmployees(function (error, employees) {
    if (error) {
      return next(error);
    }
    oss.addBreadcrumb(req, 'Transfer my team maintainer role');
    oss.render(req, res, 'org/team/maintainers/transferConfirmation', team.name + ' - Transfer your team maintainance role', {
      team: team,
      teamUrl: req.teamUrl,
      employees: employees,
    });
  });
});

router.post('/transfer', function (req, res, next) {
  var team = req.team;
  var dc = req.app.settings.dataclient;
  var newMaintainer = req.body.newMaintainer;
  if (newMaintainer == req.user.github.id) {
    return next(new Error('You are already a team maintainer, so you cannot transfer the role to yourself.'));
  }
  dc.getLink(newMaintainer, function (error, link) {
    if (error) {
      return next(error);
    }
    var username = link.ghu._;
    team.addMembership('maintainer', username, function (addMaintainerError) {
      req.oss.saveUserAlert(req, 'Added "' + username + '" to the team as a maintainer.', 'Maintainer Transfer Part 1 of 2', 'success');
      if (addMaintainerError) {
        return next(addMaintainerError);
      }
      // Downgrade ourselves now!
      team.addMembership('member', function (addError) {
        if (addError) {
          return next(addError);
        }
        req.oss.saveUserAlert(req, 'Remove you as a maintainer.', 'Maintainer Transfer Part 2 of 2', 'success');
        res.redirect('/');
      });
    });
  });
});

module.exports = router;
