//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { NextFunction, Response, Router } from 'express';
import asyncHandler from 'express-async-handler';

import {
  apiContextMiddleware,
  AddLinkToRequest,
  requireAccessTokenClient,
  setIdentity,
  jsonError,
  requireAuthenticatedUserOrSignIn,
} from '../../middleware';
import { getProviders } from '../../lib/transitional';

import getCompanySpecificDeployment from '../../middleware/companySpecificDeployment';

import type { ReposAppRequest } from '../../interfaces';
import type { IndividualContext } from '../../business/user';

import routeClientNewRepo from './newRepo';
import routeContext from './context';
import routeOrganizations from './organizations';
import routeLinking from './linking';
import routeSession from './session';
import routeBanner from './banner';
import routeNews from './news';
import routeCrossOrganizationPeople from './people';
import routeCrossOrganizationRepos from './repos';
import routeCrossOrganizationTeams from './teams';
import routeUsers from './users';

const router: Router = Router();

router.use((req: ReposAppRequest, res: Response, next: NextFunction) => {
  const { config } = getProviders(req);
  if (config?.features?.allowApiClient) {
    if (req.isAuthenticated()) {
      return next();
    } else if (req.query.authenticate === 'session') {
      return requireAuthenticatedUserOrSignIn(req, res, next);
    }
    return next(jsonError('Session is not authenticated', 401));
  }
  return next(jsonError('Client API features unavailable', 403));
});

router.use(asyncHandler(requireAccessTokenClient));
router.use(apiContextMiddleware);
router.use(setIdentity);
router.use(asyncHandler(AddLinkToRequest));

router.use('/newRepo', routeClientNewRepo);

router.use('/context', routeContext);

router.use('/banner', routeBanner);
router.use('/orgs', routeOrganizations);
router.use('/link', routeLinking);
router.use('/signout', routeSession);
router.use('/people', routeCrossOrganizationPeople);
router.use('/repos', routeCrossOrganizationRepos);
router.use('/teams', routeCrossOrganizationTeams);
router.use('/users', routeUsers);
router.use('/news', routeNews);

const dynamicStartupInstance = getCompanySpecificDeployment();
dynamicStartupInstance?.routes?.api?.index && dynamicStartupInstance?.routes?.api?.index(router);

router.get('/', (req: ReposAppRequest, res) => {
  const { config } = getProviders(req);
  const runtimeConfiguration = req.app.runtimeConfiguration;

  const activeContext = (req.individualContext || req.apiContext) as IndividualContext;
  const isGitHubAuthenticated = !!activeContext.getSessionBasedGitHubIdentity()?.id;
  const data = {
    deployment: config.continuousDeployment,
    frontend: runtimeConfiguration?.client || {},
    hosting: {
      app: config?.web?.app,
      baseUrl: config?.webServer?.baseUrl,
      server: {
        port: config?.webServer?.port,
        hostname: req.hostname,
      },
      appService: config?.webServer?.appService?.name
        ? {
            name: config?.webServer?.appService?.name,
            slot: config?.webServer?.appService?.advanced?.slotType || config?.webServer?.appService?.slot,
            region: config?.webServer?.appService?.region,
          }
        : undefined,
    },
    runtime: {
      node: {
        environment: config?.node?.environment,
        version: config?.node?.version,
      },
    },
    development: {
      githubCodespacesConnected: config?.github?.codespaces?.connected === true ? true : undefined,
      githubCodespacesName: config?.github?.codespaces?.name,
    },
    app: {
      environment: config?.environment?.name,
      appName: config?.web?.app,
    },
    session: {
      corporateIdentity: activeContext.corporateIdentity,
      githubIdentity: activeContext.getGitHubIdentity(),
      isAuthenticated: true,
      isGitHubAuthenticated,
      isLinked: !!activeContext.link,
      hasAdditionalLinks: activeContext.hasAdditionalLinks,
      impersonation: config.impersonation?.corporateId
        ? {
            corporateId: config.impersonation.corporateId,
            githubId: config.impersonation.githubId,
          }
        : undefined,
    },
  };

  res.contentType('application/json');
  return res.send(JSON.stringify(data, null, 2));
});

router.use((req, res: Response, next: NextFunction) => {
  return next(jsonError('The resource or endpoint you are looking for is not there', 404));
});

export default router;
