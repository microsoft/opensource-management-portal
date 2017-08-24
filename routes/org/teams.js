//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

const express = require('express');
const lowercaser = require('../../middleware/lowercaser');
const router = express.Router();
const utils = require('../../utils');

const teamRoute = require('./team/');

router.use(function (req, res, next) {
  req.legacyUserContext.addBreadcrumb(req, 'Teams');
  req.reposContext = {
    section: 'teams',
    organization: req.organization,
  };
  next();
});

router.get('/', function (req, res, next) {
  const beforeLinkReferrer = utils.popSessionVariable(req, res, 'beforeLinkReferrer');
  if (beforeLinkReferrer !== undefined) {
    return res.redirect(beforeLinkReferrer);
  }
  return next();
});

router.get('/', lowercaser(['sort', 'set']), require('../teamsPager'));

router.use('/:teamSlug', (req, res, next) => {
  const organization = req.organization;
  const orgBaseUrl = organization.baseUrl;
  const slug = req.params.teamSlug;
  organization.getTeamFromName(slug, (getTeamError, team) => {
    // Redirect if a name was provided when a slug is more appropriate
    if (getTeamError && getTeamError.slug) {
      return res.redirect(`${orgBaseUrl}teams/${getTeamError.slug}`);
    }
    if (getTeamError) {
      return next(getTeamError);
    }

    // The `req.team` variable is currently used by the "legacy"
    // operations system, so for the time being until there is more
    // appropriate time for refactoring, this will have to do.
    req.team2 = team;

    // Breadcrumb and path updates
    req.teamUrl = `${orgBaseUrl}teams/${team.slug}/`;
    req.legacyUserContext.addBreadcrumb(req, team.name);

    return next();
  });
});

router.use('/:teamname', teamRoute);

module.exports = router;
