//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import express = require('express');
import asyncHandler from 'express-async-handler';
const router = express.Router();

import { ReposAppRequest } from '../../transitional';
import { wrapError } from '../../utils';
import { Organization, OrganizationMembershipState } from '../../business/organization';
import { Operations } from '../../business/operations';

interface IOrganizationMembershipState {
  state: OrganizationMembershipState;
  org: Organization;
}

interface ILocalLeaveRequest extends ReposAppRequest {
  orgLeave?: {
    state: OrganizationMembershipState;
    memberOfOrgs?;
  };
}

router.use(asyncHandler(async (req: ILocalLeaveRequest, res, next) => {
  const organization = req.organization as Organization;
  const operations = req.app.settings.operations as Operations;
  req.orgLeave = {
    state: null,
  };
  const username = req.individualContext.getGitHubIdentity().username;
  const memberOfOrgs: IOrganizationMembershipState[] = [];
  for (let org of operations.organizations.values()) {
    const stateResult = await org.getOperationalMembership(username);
    const state = stateResult ? stateResult.state : null;
    if (org.name === organization.name) {
      req.orgLeave.state = state; // This specific org...
    }
    if (state == OrganizationMembershipState.Active || state == OrganizationMembershipState.Pending) {
      memberOfOrgs.push({ state, org });
    }
  }
  if (!req.orgLeave.state) {
    return res.redirect('/');
  } else {
    req.orgLeave.memberOfOrgs = memberOfOrgs;
    req.individualContext.webContext.pushBreadcrumb('Leave');
    return next();
  }
}));

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

router.post('/', asyncHandler(async function (req: ReposAppRequest, res, next) {
  const organization = req.organization;
  const operations = req.app.settings.providers.operations;
  const username = req.individualContext.getGitHubIdentity().username;
  try {
    await organization.removeMember(username);
    req.individualContext.webContext.saveUserAlert(`You have been removed from the ${organization.name} and are no longer a member.`, organization.name, 'success');
    res.redirect(operations.baseUrl || '/');
  } catch (error) {
    return next(wrapError(error, `We received an error code back from GitHub when trying to remove your membership from ${organization.name}.`));
  }
}));

module.exports = router;
