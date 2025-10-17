//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { NextFunction, Response, Router } from 'express';

import {
  apiContextMiddleware,
  tryAddLinkToRequest,
  requireAccessTokenClient,
  setIdentity,
  jsonError,
  requireAuthenticatedUserOrSignIn,
} from '../../middleware/index.js';
import { CreateError, getProviders } from '../../lib/transitional.js';

import getCompanySpecificDeployment from '../../middleware/companySpecificDeployment.js';

import type { ReposAppRequest } from '../../interfaces/index.js';
import type { IndividualContext } from '../../business/user/index.js';

import routeClientNewRepo from './newRepo.js';
import routeContext from './context/index.js';
import routeOrganizations from './organizations.js';
import routeLinking from './linking.js';
import routeSession from './session.js';
import routeBanner from './banner.js';
import routeNews from './news.js';
import routeCrossOrganizationPeople from './people.js';
import routeCrossOrganizationRepos from './repos.js';
import routeCrossOrganizationTeams from './teams.js';
import routeUsers from './users.js';
import { type SiteStaticFeatures, getSiteStaticFeatures } from '../../lib/features.js';

const router: Router = Router();

let staticSiteFeatures: SiteStaticFeatures = null;

router.use((req: ReposAppRequest, res: Response, next: NextFunction) => {
  const { query } = req;
  const { config } = getProviders(req);
  if (config?.features?.allowApiClient) {
    // prettier-ignore
    if (req.isAuthenticated()) {
      // prettier-ignore
      return next(); // CodeQL [SM01513] this is not a security decision but rather a redirect to authentication when requested
    } else if (query?.authenticate === 'session') { // CodeQL [SM01513] this is not a security decision but rather to redirect and require web authenticated sessions when this value is requested
      return requireAuthenticatedUserOrSignIn(req, res, next);
    }
    return next(CreateError.NotAuthenticated('Session is not authenticated'));
  }
  return next(CreateError.NotAuthorized('Client API features unavailable'));
});

router.use(requireAccessTokenClient);
router.use(apiContextMiddleware);
router.use(setIdentity);
router.use(tryAddLinkToRequest);

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
if (dynamicStartupInstance?.routes?.api?.index) {
  dynamicStartupInstance?.routes?.api?.index(router);
}

router.get('/', (req: ReposAppRequest, res) => {
  const providers = getProviders(req);
  const { config } = providers;
  const runtimeConfiguration = req.app.runtimeConfiguration;

  if (staticSiteFeatures === null) {
    staticSiteFeatures = getSiteStaticFeatures(providers);
  }

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
    staticSiteFeatures,
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
  return res.send(JSON.stringify(data, null, 2)) as unknown as void;
});

router.use((req, res: Response, next: NextFunction) => {
  return next(jsonError('The resource or endpoint you are looking for is not there', 404));
});

export default router;
