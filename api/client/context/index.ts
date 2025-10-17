//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { NextFunction, Response, Router } from 'express';

import { Organization } from '../../../business/index.js';
import { IProviders, ReposAppRequest } from '../../../interfaces/index.js';

import { jsonError } from '../../../middleware/index.js';
import getCompanySpecificDeployment from '../../../middleware/companySpecificDeployment.js';
import { ErrorHelper, getProviders } from '../../../lib/transitional.js';
import { IndividualContext } from '../../../business/user/index.js';

import routeApprovals from './approvals.js';
import routeIndividualContextualOrganization from './organization/index.js';
import routeOrgs from './orgs.js';
import routeRepos from './repos.js';
import routeTeams from './teams.js';
import routeAdministration from './administration/index.js';
import routeSample from './sample.js';
import routeSettings from './settings.js';

const router: Router = Router();

const deployment = getCompanySpecificDeployment();
if (deployment?.routes?.api?.context?.index) {
  deployment?.routes?.api?.context?.index(router);
}

router.use('/approvals', routeApprovals);

router.get('/', (req: ReposAppRequest, res) => {
  const { config } = getProviders(req);
  const { continuousDeployment } = config;
  const activeContext = (req.individualContext || req.apiContext) as IndividualContext;
  const isGitHubAuthenticated = !!activeContext.getSessionBasedGitHubIdentity()?.id;
  const data = {
    corporateIdentity: activeContext.corporateIdentity,
    githubIdentity: activeContext.getGitHubIdentity(),
    isAuthenticated: true,
    isGitHubAuthenticated,
    isLinked: !!activeContext.link,
    build: continuousDeployment,
    hasAdditionalLinks: activeContext.hasAdditionalLinks,
  };
  return res.json(data) as unknown as void;
});

router.get(
  '/specialized/multipleLinkGitHubIdentities',
  async (req: ReposAppRequest, res: Response, next: NextFunction) => {
    const { operations } = getProviders(req);
    const activeContext = (req.individualContext || req.apiContext) as IndividualContext;
    const links = (activeContext?.link ? [activeContext.link, ...activeContext.additionalLinks] : []).map(
      (link) => link.thirdPartyUsername
    );
    const response = {
      deletedOrChangedUsernames: [],
      logins: [],
    };
    for (const username of links) {
      try {
        const details = await operations.getAccountByUsername(username);
        if (details) {
          const json = details.asJson();
          response.logins.push(json);
        } else {
          response.deletedOrChangedUsernames.push(username);
        }
      } catch (error) {
        // we don't want to interrupt this if they deleted an account
        console.warn(error);
        response.deletedOrChangedUsernames.push(username);
      }
    }
    return res.json(response) as unknown as void;
  }
);

router.get('/accountDetails', async (req: ReposAppRequest, res: Response, next: NextFunction) => {
  const { operations } = getProviders(req);
  const activeContext = (req.individualContext || req.apiContext) as IndividualContext;
  try {
    const gh = activeContext.getGitHubIdentity();
    if (gh?.id) {
      const accountFromId = operations.getAccount(gh.id);
      const accountDetails = await accountFromId.getDetails();
      res.json(accountDetails);
    } else {
      res.status(400);
      res.end();
    }
  } catch (error) {
    return next(error);
  }
});

router.use('/administration', routeAdministration);

router.get('/orgs', routeOrgs);
router.get('/repos', routeRepos);
router.get('/teams', routeTeams);
router.use('/sample', routeSample);
router.use('/settings', routeSettings);

router.use('/orgs/:orgName', async (req: ReposAppRequest, res: Response, next: NextFunction) => {
  const { orgName } = req.params;
  const providers = getProviders(req);
  const { operations } = providers;
  // const activeContext = (req.individualContext || req.apiContext) as IndividualContext;
  // if (!activeContext.link) {
  //   return next(jsonError('Account is not linked', 400));
  // }
  let organization: Organization = null;
  try {
    organization = operations.getOrganization(orgName);
    // CONSIDER: what if they are not currently a member of the org?
    req.organization = organization;
    return next();
  } catch (noOrgError) {
    if (ErrorHelper.IsNotFound(noOrgError)) {
      // Could be either the org truly does not exist, OR, it's uncontrolled.
      if (await isUnmanagedOrganization(providers, orgName)) {
        res.status(204);
        res.end();
        return;
      }
      res.status(404);
      res.end();
      return;
    }
    return next(jsonError(noOrgError, 500));
  }
});

async function isUnmanagedOrganization(providers: IProviders, orgName: string): Promise<boolean> {
  const { operations } = providers;
  const organization = operations.getUncontrolledOrganization(orgName);
  try {
    const details = await organization.getDetails();
    return !!details.id;
  } catch (error) {
    if (!ErrorHelper.IsNotFound(error)) {
      throw error;
    }
  }
  return false;
}

router.use('/orgs/:orgName', routeIndividualContextualOrganization);

router.use('/*splat', (req: ReposAppRequest, res: Response, next: NextFunction) => {
  return next(jsonError('Contextual API or route not found', 404));
});

export default router;
