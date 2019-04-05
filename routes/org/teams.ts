//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

import express = require('express');
import { ReposAppRequest } from '../../transitional';
import { popSessionVariable } from '../../utils';
const lowercaser = require('../../middleware/lowercaser');
const router = express.Router();

const teamRoute = require('./team/');

interface ITeamsRequest extends ReposAppRequest {
  team2?: any;
  teamUrl?: any;
}

router.use(function (req: ReposAppRequest, res, next) {
  req.individualContext.webContext.pushBreadcrumb('Teams');
  req.reposContext = {
    section: 'teams',
    organization: req.organization,
  };
  next();
});

router.get('/', function (req, res, next) {
  const beforeLinkReferrer = popSessionVariable(req, res, 'beforeLinkReferrer');
  if (beforeLinkReferrer !== undefined) {
    return res.redirect(beforeLinkReferrer);
  }
  return next();
});

router.get('/', lowercaser(['sort', 'set']), require('../teamsPager'));

router.use('/:teamSlug', (req: ITeamsRequest, res, next) => {
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
    req.individualContext.webContext.pushBreadcrumb(team.name);

    return next();
  });
});

router.use('/:teamname', teamRoute);

module.exports = router;
