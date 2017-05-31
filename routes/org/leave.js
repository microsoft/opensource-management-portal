//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

const express = require('express');
const router = express.Router();
const async = require('async');
const utils = require('../../utils');

router.use(function (req, res, next) {
  var org = req.org;
  req.orgLeave = {
    state: null,
  };
  var memberOfOrgs = [];
  async.each(org.oss.orgs(), function (o, callback) {
    o.queryUserMembership(false /* no caching */, function (error, result) {
      var state = null;
      if (result && result.state) {
        state = result.state;
      }
      // This specific org...
      if (o.name == org.name) {
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
      org.oss.addBreadcrumb(req, 'Leave');
      next();
    }
  });
});

router.get('/', function (req, res) {
  var org = req.org;
  var orgs = req.orgLeave.memberOfOrgs;
  req.oss.render(req, res, 'org/leave', 'Leave ' + org.name, {
    org: org,
    orgs: orgs,
  });
});

router.post('/', function (req, res, next) {
  var org = req.org;
  org.removeUserMembership(function (error) {
    if (error) {
      return next(utils.wrapError(error, 'We received an error code back from GitHub when trying to remove your membership from ' + org.name + '.'));
    }
    req.oss.saveUserAlert(req, 'Your ' + org.name + ' membership has been canceled at your request.', org.name, 'success');
    res.redirect('/');
  });
});

module.exports = router;
