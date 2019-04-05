//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import express = require('express');
const router = express.Router();
import async = require('async');
import { ReposAppRequest } from '../../transitional';
import { wrapError } from '../../utils';

interface ILocalLeaveRequest extends ReposAppRequest {
  orgLeave?: any;
}

router.use(function (req: ILocalLeaveRequest, res, next) {
  const organization = req.organization;
  const operations = req.app.settings.operations;
  req.orgLeave = {
    state: null,
  };
  const username = req.individualContext.getGitHubIdentity().username;
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
      req.individualContext.webContext.pushBreadcrumb('Leave');
      next();
    }
  });
});

router.get('/', function (req: ILocalLeaveRequest, res) {
  const organization = req.organization;
  const organizations = req.orgLeave.memberOfOrgs;
  req.individualContext.webContext.render({
    view: 'org/leave',
    title: 'Leave ' + organization.name,
    state: {
      org: organization,
      orgs: organizations,
    },
  });
});

router.post('/', function (req: ReposAppRequest, res, next) {
  const organization = req.organization;
  const operations = req.app.settings.providers.operations;
  const username = req.individualContext.getGitHubIdentity().username;
  organization.removeMember(username, error => {
    if (error) {
      return next(wrapError(error, `We received an error code back from GitHub when trying to remove your membership from ${organization.name}.`));
    }
    req.individualContext.webContext.saveUserAlert(`You have been removed from the ${organization.name} and are no longer a member.`, organization.name, 'success');
    res.redirect(operations.baseUrl || '/');
  });
});

module.exports = router;
