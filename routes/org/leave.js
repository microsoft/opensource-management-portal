//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

const express = require('express');
const router = express.Router();
const async = require('async');
const utils = require('../../utils');

router.use(function (req, res, next) {
  const organization = req.organization;
  const operations = req.app.settings.operations;
  req.orgLeave = {
    state: null,
  };
  const username = req.legacyUserContext.usernames.github;
  const memberOfOrgs = [];
  async.each(operations.organizations, function (o, callback) {
    o.getOperationalMembership(username, (error, result) => {
      let state = null;
      if (result && result.state) {
        state = result.state;
      }
      // This specific org...
      if (o.name == organization.name) {
        req.orgLeave.state = state;
      }
      if (state == 'active' || state == 'pending') {
        memberOfOrgs.push({
          state: state,
          org: o,
        });
      }
      callback(error);
    });
  }, function (error) {
    if (error) {
      return next(error);
    }
    if (!req.orgLeave.state) {
      return res.redirect('/');
    } else {
      req.orgLeave.memberOfOrgs = memberOfOrgs;
      req.legacyUserContext.addBreadcrumb(req, 'Leave');
      next();
    }
  });
});

router.get('/', function (req, res) {
  const organization = req.organization;
  const organizations = req.orgLeave.memberOfOrgs;
  req.legacyUserContext.render(req, res, 'org/leave', 'Leave ' + organization.name, {
    org: organization,
    orgs: organizations,
  });
});

router.post('/', function (req, res, next) {
  const organization = req.organization;
  const operations = req.app.settings.providers.operations;
  const username = req.legacyUserContext.usernames.github;
  organization.removeMember(username, error => {
    if (error) {
      return next(utils.wrapError(error, `We received an error code back from GitHub when trying to remove your membership from ${organization.name}.`));
    }
    req.legacyUserContext.saveUserAlert(req, `You have been removed from the ${organization.name} and are no longer a member.`, organization.name, 'success');
    res.redirect(operations.baseUrl || '/');
  });
});

module.exports = router;
