//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { NextFunction, Response, Router } from 'express';
const router: Router = Router();

import { getProviders, validateGitHubLogin } from '../../../lib/transitional.js';
import {
  ReposAppRequest,
  RequestTeamMemberAddType,
  NoCacheNoBackground,
  UserAlertType,
} from '../../../interfaces/index.js';
import { Team, TeamMember } from '../../../business/index.js';

import MiddlewareTeamAdminRequired from './teamAdminRequired.js';

import RoutePeopleSearch from '../../peopleSearch.js';

interface ILocalRequest extends ReposAppRequest {
  team2?: Team;
  verifiedCurrentMaintainers?: any;
  teamUrl?: any;
  team2AddType?: RequestTeamMemberAddType;
}

router.use(async (req: ILocalRequest, res: Response, next: NextFunction) => {
  // Get the latest maintainers, forced, with every request
  const team2 = req.team2 as Team;
  const maintainers = await refreshMaintainers(team2);
  if (maintainers) {
    req.verifiedCurrentMaintainers = maintainers;
  }
  return next();
});

async function refreshMaintainers(team2: Team): Promise<TeamMember[]> {
  return team2.getMaintainers(NoCacheNoBackground);
}

router.get('/refresh', (req: ILocalRequest, res) => {
  // Since the views are cached, this can help resolve support situations before they start
  res.redirect(req.teamUrl);
});

router.post(
  '/:id/downgrade',
  MiddlewareTeamAdminRequired,
  async (req: ILocalRequest, res: Response, next: NextFunction) => {
    const team2 = req.team2 as Team;
    const id = req.params.id;
    const verifiedCurrentMaintainers = req.verifiedCurrentMaintainers;

    let maintainer = null;
    for (let i = 0; i < verifiedCurrentMaintainers.length; i++) {
      if (verifiedCurrentMaintainers[i].id == id /* less truthy, strings */) {
        maintainer = verifiedCurrentMaintainers[i];
        break;
      }
    }
    if (!maintainer) {
      return next(
        new Error(
          `The GitHub user with ID ${id} is not currently a maintainer of the team, so cannot be downgraded.`
        )
      );
    }
    const username = maintainer.login;
    await team2.addMembership(username);
    req.individualContext.webContext.saveUserAlert(
      `Downgraded ${username} from a team maintainer to a team member`,
      team2.name + ' membership updated',
      UserAlertType.Success
    );
    const maintainers = await refreshMaintainers(team2);
    res.redirect(req.teamUrl);
  }
);

router.use('/add', MiddlewareTeamAdminRequired, (req: ILocalRequest, res: Response, next: NextFunction) => {
  req.team2AddType = RequestTeamMemberAddType.Maintainer;
  return next();
});

router.post(
  '/add',
  MiddlewareTeamAdminRequired,
  async function (req: ILocalRequest, res: Response, next: NextFunction) {
    const { operations } = getProviders(req);
    const login = validateGitHubLogin(req.body.username);
    const team2 = req.team2 as Team;
    await team2.addMaintainer(login);
    req.individualContext.webContext.saveUserAlert(
      `Added ${login} as a team maintainer`,
      team2.name + ' membership updated',
      UserAlertType.Success
    );
    const maintainers = await refreshMaintainers(team2);
    return res.redirect(req.teamUrl);
  }
);

router.use('/add', RoutePeopleSearch);

export default router;
