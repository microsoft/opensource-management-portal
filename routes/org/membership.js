//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

const express = require('express');
const router = express.Router();
const utils = require('../../utils');

router.get('/', function (req, res, next) {
  const organization = req.organization;
  if (!organization) {
    // TODO: Was this ever a possible situation? What's going on here? Probably was v1 (single-org)
    return next(new Error('No organization instance available'));
  }
  const onboarding = req.query.onboarding;
  const joining = req.query.joining;
  const username = req.legacyUserContext.usernames.github;
  organization.checkPublicMembership(username, function (error, result) {
    let publicMembership = result === true;
    req.legacyUserContext.addBreadcrumb(req, 'Membership Visibility');
    let teamPostfix = '';
    if (onboarding || joining) {
      teamPostfix = '?' + (onboarding ? 'onboarding' : 'joining') + '=' + (onboarding || joining);
    }
    req.legacyUserContext.render(req, res, 'org/publicMembershipStatus', organization.name + ' Membership Visibility', {
      organization: organization,
      publicMembership: publicMembership,
      theirUsername: username,
      onboarding: onboarding,
      joining: joining,
      teamPostfix: teamPostfix,
      showBreadcrumbs: onboarding === undefined,
    });
  });
});

router.post('/', function (req, res, next) {
  const user = req.user;
  const context = req.legacyUserContext;
  const username = context.usernames.github;
  const organization = req.organization;
  if (!organization) {
    // TODO: Was this ever a possible situation? What's going on here? Probably was v1 (single-org)
    return next(new Error('No organization instance available'));
  }
  const onboarding = req.query.onboarding;
  const joining = req.query.joining;
  const writeToken = context.tokens.githubIncreasedScope || (user && user.githubIncreasedScope ? user.githubIncreasedScope.accessToken : null);
  if (writeToken) {
    const message1 = req.body.conceal ? 'concealing' : 'publicizing';
    const message2 = req.body.conceal ? 'hidden' : 'public, thanks for your support';
    organization[req.body.conceal ? 'concealMembership' : 'publicizeMembership'].call(organization, username, writeToken, function (error) {
      if (error) {
        return next(utils.wrapError(error, 'We had trouble ' + message1 + ' your membership. Did you authorize the increased scope of access with GitHub?'));
      }
      req.legacyUserContext.saveUserAlert(req, 'Your ' + organization.name + ' membership is now ' + message2 + '!', organization.name, 'success');
      var url = organization.baseUrl + ((onboarding || joining) ? '/teams' : '');
      var extraUrl = (onboarding || joining) ? '?' + (onboarding ? 'onboarding' : 'joining') + '=' + (onboarding || joining) : '';
      res.redirect(url + extraUrl);
    });
  } else {
    return next(new Error('The increased scope to write the membership to GitHub was not found in your session. Please report this error.'));
  }
});

module.exports = router;
