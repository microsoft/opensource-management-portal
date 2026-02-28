//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { NextFunction, Response, Router } from 'express';
const router: Router = Router();

import { ReposAppRequest } from '../../interfaces/index.js';
import { popSessionVariable } from '../../lib/utils.js';
import lowercaser from '../../middleware/lowercaser.js';

import RouteTeam from './team//index.js';
import RouteTeamsPager from '../teamsPager.js';

interface ITeamsRequest extends ReposAppRequest {
  team2?: any;
  teamUrl?: any;
}

router.use(function (req: ReposAppRequest, res: Response, next: NextFunction) {
  req.reposContext = {
    section: 'teams',
    organization: req.organization,
  };
  next();
});

router.get('/', function (req: ITeamsRequest, res: Response, next: NextFunction) {
  const beforeLinkReferrer = popSessionVariable(req, res, 'beforeLinkReferrer');
  if (beforeLinkReferrer !== undefined) {
    return res.redirect(beforeLinkReferrer);
  }
  return next();
});

router.get('/', lowercaser(['sort', 'set']), RouteTeamsPager);

router.use('/:teamSlug', async (req: ITeamsRequest, res: Response, next: NextFunction) => {
  const organization = req.organization;
  const orgBaseUrl = organization.baseUrl;
  const slug = req.params.teamSlug as string;
  try {
    const team = await organization.getTeamFromName(slug);
    req.team2 = team;
    // Breadcrumb and path updates
    req.teamUrl = `${orgBaseUrl}teams/${team.slug}/`;
    return next();
  } catch (getTeamError) {
    if (getTeamError && getTeamError.slug) {
      // Redirect if a name was provided when a slug is more appropriate
      return res.redirect(`${orgBaseUrl}teams/${getTeamError.slug}`);
    }
    if (getTeamError) {
      return next(getTeamError);
    }
  }
});

router.use('/:teamname', RouteTeam);

export default router;
