//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

/*eslint no-console: ["error", { allow: ["warn"] }] */

'use strict';

import express = require('express');
import asyncHandler from 'express-async-handler';
const router = express.Router();

import { ReposAppRequest } from '../transitional';
import { wrapError } from '../utils';
import { Operations, UnlinkPurpose } from '../business/operations';
import { OrganizationMembershipState } from '../business/organization';

router.use(asyncHandler(async function (req: ReposAppRequest, res, next) {
  const memberOfOrganizations = [];
  const operations = req.app.settings.providers.operations as Operations;
  const ghi = req.individualContext.getGitHubIdentity();
  if (!ghi || !ghi.username) {
    return next(new Error('GitHub identity required'));
  }
  const username = ghi.username;
  for (let organization of operations.organizations.values()) {
    try {
      const result = await organization.getMembership(username);
      let state = null;
      if (result && result.state) {
        state = result.state;
      }
      if (state === OrganizationMembershipState.Active || state === OrganizationMembershipState.Pending) {
        memberOfOrganizations.push(organization);
      }
    } catch (error) {
      // TODO: consider insights here, but we do not want to halt progress
      // on allowing unlink operations
    }
  }
  req.currentOrganizationMemberships = memberOfOrganizations;
  return next();
}));

router.get('/', asyncHandler(async (req: ReposAppRequest, res, next) => {
  const link = req.individualContext.link;
  const id = req.individualContext.getGitHubIdentity().id;
  const operations = req.app.settings.providers.operations as Operations;
  const account = operations.getAccount(id);
  const currentOrganizationMemberships = await account.getOperationalOrganizationMemberships();
  if (link && id) {
    return req.individualContext.webContext.render({
      view: 'unlink',
      title: 'Remove corporate link and organization memberships',
      state: {
        organizations: currentOrganizationMemberships,
      },
    });
  } else {
    return next(new Error('No link could be found.'));
  }
}));

router.post('/', asyncHandler(async function (req: ReposAppRequest, res, next) {
  const id = req.individualContext.getGitHubIdentity().id;
  const operations = req.app.settings.providers.operations as Operations;
  // const account = operations.getAccount(id);
  const insights = req.insights;
  const terminationOptions = {
    reason: 'User used the unlink function on the web site',
    purpose: UnlinkPurpose.Self,
  };
  let history: string[] = [];
  let error = null;
  try {
    history = await operations.terminateLinkAndMemberships(id, terminationOptions);
  } catch (exception) {
    insights.trackException({ exception } );
    error = exception;
  }
  const hadErrors = error ? 'had errors' : 'no';
  let eventData = {
    id: id.toString(),
    hadErrors,
  };
  for (let i = 0; i < history.length; i++) {
    const historyKey = `log${i + 1}`;
    eventData[historyKey] = history[i];
  }
  insights.trackEvent({ name: 'PortalUserUnlink', properties: eventData });
  if (error) {
    return next(wrapError(error, 'You were successfully removed from all of your organizations. However, a failure happened during a data housecleaning operation with GitHub. Double check that you are happy with your current membership status on GitHub.com before continuing.'));
  } else {
    return res.redirect('/signout?unlink');
  }
}));

module.exports = router;
