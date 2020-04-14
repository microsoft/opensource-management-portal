//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import express = require('express');
import asyncHandler from 'express-async-handler';

import { ReposAppRequest } from '../../transitional';
import { wrapError } from '../../utils';
const router = express.Router();

router.get('/', asyncHandler(async function (req: ReposAppRequest, res, next) {
  const organization = req.organization;
  if (!organization) {
    // TODO: Was this ever a possible situation? What's going on here? Probably was v1 (single-org)
    return next(new Error('No organization instance available'));
  }
  const onboarding = req.query.onboarding;
  const joining = req.query.joining;
  const username = req.individualContext.getGitHubIdentity().username;
  const hasWriteToken = !! req.individualContext.webContext.tokens.gitHubWriteOrganizationToken;
  let result = null;
  try {
    result = await organization.checkPublicMembership(username);
  } catch (ignoredError) { /* ignored */ }
  let publicMembership = result === true;
  req.individualContext.webContext.pushBreadcrumb('Membership Visibility');
  let teamPostfix = '';
  if (onboarding || joining) {
    teamPostfix = '?' + (onboarding ? 'onboarding' : 'joining') + '=' + (onboarding || joining);
  }
  req.individualContext.webContext.render({
    view: 'org/publicMembershipStatus',
    title: organization.name + ' Membership Visibility',
    state: {
      organization,
      publicMembership,
      theirUsername: username,
      onboarding,
      hasWriteToken,
      joining,
      teamPostfix,
      showBreadcrumbs: onboarding === undefined,
    },
  });
}));

router.post('/', asyncHandler(async function (req: ReposAppRequest, res, next) {
  const username = req.individualContext.getGitHubIdentity().username;
  const organization = req.organization;
  if (!organization) {
    // TODO: Was this ever a possible situation? What's going on here? Probably was v1 (single-org)
    return next(new Error('No organization instance available'));
  }
  const onboarding = req.query.onboarding;
  const joining = req.query.joining;
  const writeToken = req.individualContext.webContext.tokens.gitHubWriteOrganizationToken;
  if (!writeToken) {
    return next(new Error('The increased scope to write the membership to GitHub was not found in your session. Please report this error.'));
  }
  const message1 = req.body.conceal ? 'concealing' : 'publicizing';
  const message2 = req.body.conceal ? 'hidden' : 'public, thanks for your support';
  try {
    const result = await organization[req.body.conceal ? 'concealMembership' : 'publicizeMembership'].call(organization, username, writeToken);
    // TODO: validate this works, since it is blindly calling now!
  } catch (error) {
    return next(wrapError(error, `We had trouble ${message1} your membership. Did you authorize the increased scope of access with GitHub? ${error.message}`));
  }
  req.individualContext.webContext.saveUserAlert('Your ' + organization.name + ' membership is now ' + message2 + '!', organization.name, 'success');
  const url = organization.baseUrl + ((onboarding || joining) ? '/teams' : '');
  const extraUrl = (onboarding || joining) ? '?' + (onboarding ? 'onboarding' : 'joining') + '=' + (onboarding || joining) : '';
  return res.redirect(url + extraUrl);
}));

module.exports = router;
