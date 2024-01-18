//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { NextFunction, Response, Router } from 'express';
import asyncHandler from 'express-async-handler';

import { Organization, Team } from '../../../../business';
import {
  ReposAppRequest,
  OrganizationMembershipRole,
  TeamJsonFormat,
  GitHubTeamRole,
} from '../../../../interfaces';
import { jsonError } from '../../../../middleware';
import getCompanySpecificDeployment from '../../../../middleware/companySpecificDeployment';
import { IndividualContext } from '../../../../business/user';

import routeRepos from './repos';
import routeTeams from './teams';
import { CreateError } from '../../../../lib/transitional';

const router: Router = Router();

router.get(
  '/',
  asyncHandler(async (req: ReposAppRequest, res: Response, next: NextFunction) => {
    const { organization } = req;
    const activeContext = (req.individualContext || req.apiContext) as IndividualContext;
    if (!activeContext.link) {
      return res.json(false) as unknown as void;
    }
    const membership = await organization.getOperationalMembership(
      activeContext.getGitHubIdentity().username
    );
    if (!membership) {
      return res.json(false) as unknown as void;
    }
    return res.json({
      user: toSanitizedUser(membership.user),
      organization: toSanitizedOrg(membership.organization),
      role: membership.role,
      state: membership.state,
    }) as unknown as void;
  })
);

router.get(
  '/sudo',
  asyncHandler(async (req: ReposAppRequest, res: Response, next: NextFunction) => {
    const { organization } = req;
    const activeContext = (req.individualContext || req.apiContext) as IndividualContext;
    if (!activeContext.link) {
      return res.json({ isSudoer: false }) as unknown as void;
    }
    return res.json({
      isSudoer: await organization.isSudoer(activeContext.getGitHubIdentity().username, activeContext.link),
    }) as unknown as void;
  })
);

router.get(
  '/isOwner',
  asyncHandler(async (req: ReposAppRequest, res: Response, next: NextFunction) => {
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
  })
);

router.delete(
  '/',
  asyncHandler(async (req: ReposAppRequest, res: Response, next: NextFunction) => {
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
  })
);

router.get(
  '/personalizedTeams',
  asyncHandler(async (req: ReposAppRequest, res: Response, next: NextFunction) => {
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
      return res.json({
        personalizedTeams,
      }) as unknown as void;
    } catch (error) {
      return next(CreateError.InvalidParameters(error));
    }
  })
);

router.use('/repos', routeRepos);
router.use('/teams', routeTeams);

const deployment = getCompanySpecificDeployment();
deployment?.routes?.api?.context?.organization?.index &&
  deployment?.routes?.api?.context?.organization?.index(router);

router.use('*', (req: ReposAppRequest, res: Response, next: NextFunction) => {
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
