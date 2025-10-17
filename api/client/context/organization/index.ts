//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { NextFunction, Response, Router } from 'express';

import { Organization, Team } from '../../../../business/index.js';
import {
  ReposAppRequest,
  OrganizationMembershipRole,
  TeamJsonFormat,
  GitHubTeamRole,
} from '../../../../interfaces/index.js';
import { jsonError } from '../../../../middleware/index.js';
import getCompanySpecificDeployment from '../../../../middleware/companySpecificDeployment.js';
import { IndividualContext } from '../../../../business/user/index.js';

import routeRepos from './repos.js';
import routeTeams from './teams.js';
import { CreateError } from '../../../../lib/transitional.js';

const router: Router = Router();

router.get('/', async (req: ReposAppRequest, res: Response, next: NextFunction) => {
  const { organization } = req;
  const activeContext = (req.individualContext || req.apiContext) as IndividualContext;
  if (!activeContext.link) {
    return res.json(false) as unknown as void;
  }
  const membership = await organization.getOperationalMembership(activeContext.getGitHubIdentity().username);
  if (!membership) {
    return res.json(false) as unknown as void;
  }
  return res.json({
    user: toSanitizedUser(membership.user),
    organization: toSanitizedOrg(membership.organization),
    role: membership.role,
    state: membership.state,
  }) as unknown as void;
});

router.get('/sudo', async (req: ReposAppRequest, res: Response, next: NextFunction) => {
  const { organization } = req;
  const activeContext = (req.individualContext || req.apiContext) as IndividualContext;
  if (!activeContext.link) {
    return res.json({ isSudoer: false }) as unknown as void;
  }
  return res.json({
    isSudoer: await organization.isSudoer(activeContext.getGitHubIdentity().username, activeContext.link),
  }) as unknown as void;
});

router.get('/isOwner', async (req: ReposAppRequest, res: Response, next: NextFunction) => {
  const { organization } = req;
  const activeContext = (req.individualContext || req.apiContext) as IndividualContext;
  if (!activeContext.link) {
    return res.json({ isOrganizationOwner: false }) as unknown as void;
  }
  try {
    const username = activeContext.getGitHubIdentity().username;
    const membership = await organization.getOperationalMembership(username);
    const isOrganizationOwner = membership?.role === OrganizationMembershipRole.Admin;
    return res.json({
      isOrganizationOwner,
    }) as unknown as void;
  } catch (error) {
    return next(CreateError.InvalidParameters(error));
  }
});

router.delete('/', async (req: ReposAppRequest, res: Response, next: NextFunction) => {
  // "Leave" / remove my context
  const { organization } = req;
  const activeContext = (req.individualContext || req.apiContext) as IndividualContext;
  if (!activeContext.link) {
    return next(CreateError.InvalidParameters('You are not linked'));
  }
  const login = activeContext.getGitHubIdentity().username;
  const id = activeContext.getGitHubIdentity().id;
  try {
    await organization.removeMember(login, id);
    return res.json({
      message: `Your ${login} account has been removed from ${organization.name}.`,
    }) as unknown as void;
  } catch (error) {
    console.warn(error);
    return next(CreateError.InvalidParameters(error));
  }
});

router.get('/personalizedTeams', async (req: ReposAppRequest, res: Response, next: NextFunction) => {
  try {
    const organization = req.organization as Organization;
    const activeContext = (req.individualContext || req.apiContext) as IndividualContext;
    if (!activeContext.link) {
      return res.json({ personalizedTeams: [] }) as unknown as void;
    }
    const userAggregateContext = activeContext.aggregations;
    const maintainedTeams = new Set<string>();
    const userTeams = userAggregateContext.reduceOrganizationTeams(
      organization,
      await userAggregateContext.teams()
    );
    userTeams.maintainer.map((maintainedTeam) => maintainedTeams.add(maintainedTeam.id.toString()));
    const combinedTeams = new Map<string, Team>();
    userTeams.maintainer.map((team) => combinedTeams.set(team.id.toString(), team));
    userTeams.member.map((team) => combinedTeams.set(team.id.toString(), team));
    const personalizedTeams = Array.from(combinedTeams.values()).map((combinedTeam) => {
      const entry = combinedTeam.asJson(TeamJsonFormat.Augmented);
      entry.role = maintainedTeams.has(combinedTeam.id.toString())
        ? GitHubTeamRole.Maintainer
        : GitHubTeamRole.Member;
      return entry;
    });
    // Other broad and open access teams without personal membership
    const broadTeams = new Set<number>(req.organization.broadAccessTeams);
    const openAccessTeams = new Set<number>(req.organization.openAccessTeams);
    const broadOrOpenAccessIds = new Set<number>([...broadTeams.values(), ...openAccessTeams.values()]);
    const otherIds = new Set<number>();
    for (const id of broadOrOpenAccessIds) {
      if (!combinedTeams.has(id.toString())) {
        otherIds.add(id);
      }
    }
    const otherTeams: Team[] = [];
    for (const id of otherIds) {
      try {
        const team = await organization.getTeamById(id);
        if (team) {
          otherTeams.push(team);
        }
      } catch (ignoreError) {
        /* skip */
      }
    }
    const otherBroadOpenTeams = Array.from(otherTeams.values()).map((team) => {
      return team.asJson(TeamJsonFormat.Augmented);
    });
    return res.json({
      personalizedTeams,
      otherBroadOpenTeams,
    }) as unknown as void;
  } catch (error) {
    return next(CreateError.InvalidParameters(error));
  }
});

router.use('/repos', routeRepos);
router.use('/teams', routeTeams);

const deployment = getCompanySpecificDeployment();
if (deployment?.routes?.api?.context?.organization?.index) {
  deployment?.routes?.api?.context?.organization?.index(router);
}

router.use('/*splat', (req: ReposAppRequest, res: Response, next: NextFunction) => {
  return next(jsonError('no API or function available: client>organization', 404));
});

const toSanitizedUser = (user) => {
  if (!user || !user.login) {
    return undefined;
  }
  return {
    id: user.id,
    login: user.login,
    avatar_url: user.avatar_url,
  };
};

const toSanitizedOrg = (org) => {
  if (!org || !org.login) {
    return undefined;
  }
  return {
    id: org.id,
    login: org.login,
    avatar_url: org.avatar_url,
    description: org.description,
  };
};

export default router;
