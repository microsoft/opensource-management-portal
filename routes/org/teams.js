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
  req.org.oss.addBreadcrumb(req, 'Teams');
  req.reposContext = {
    section: 'teams',
    org: req.org,
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
  const legacyOrgInstance = req.org;
  const orgBaseUrl = legacyOrgInstance.baseUrl;
  const organization = req.organization;
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

    // Set the legacy team instance as well
    const clone = Object.assign({}, team);
    const legacyTeam = legacyOrgInstance.team(team.id, clone);
    req.team = legacyTeam;

    // Difference: traditionally legacyTeam.getDetails(...) would also
    // be called now to fill out the properties; this happened without
    // a cache and was quite slow for no great value provided. Need
    // to confirm that this is OK now that it is omitted.

    // Breadcrumb and path updates
    req.teamUrl = `${orgBaseUrl}teams/${team.slug}/`;
    req.oss.addBreadcrumb(req, team.name);

    return next();
  });
});

router.use('/:teamname', teamRoute);

module.exports = router;
