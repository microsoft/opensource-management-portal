//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { NextFunction, Response, Router } from 'express';
const router: Router = Router();

import { hasStaticReactClientApp } from '../lib/transitional.js';
import { storeOriginalUrlAsVariable } from '../lib/utils.js';
import { AuthorizeOnlyCorporateAdministrators } from '../middleware/business/corporateAdministrators.js';
import { injectReactClient } from '../middleware/index.js';

import type { IndividualContext } from '../business/user/index.js';
import type { ReposAppRequest } from '../interfaces/index.js';

import routeAdministration from './administration/index.js';
import routeLegacyOrganizationAdministration from './orgAdmin.js';
import routeOrgs from './orgs.js';
import routePeople from './people.js';
import routeRepos from './repos.js';
import routeTeams from './teams.js';
import routeUndo from './undo.js';
import routeUnlink from './unlink.js';

const hasReactApp = hasStaticReactClientApp();
const reactRoute = hasReactApp ? injectReactClient() : undefined;

//-----------------------------------------------------------------------------
//-----------------------------------------------------------------------------
// SECURITY ROUTE MARKER:
// Below this next call, all routes will require an active link to exist for
// the authenticated GitHub user.
//-----------------------------------------------------------------------------
// * only for the traditional app. The React app does not require a link to browse orgs.
//-----------------------------------------------------------------------------
if (!hasReactApp) {
  router.use(function (req: ReposAppRequest, res: Response, next: NextFunction) {
    const individualContext = req.individualContext as IndividualContext;
    const link = individualContext.link;
    if (link && link.thirdPartyId) {
      return next();
    }
    storeOriginalUrlAsVariable(req, res, 'beforeLinkReferrer', '/', 'no linked github username');
  });
}
// end security route
//-----------------------------------------------------------------------------
//-----------------------------------------------------------------------------

router.use('/administration', AuthorizeOnlyCorporateAdministrators, reactRoute || routeAdministration);
router.use('/organization', routeLegacyOrganizationAdministration); // admin UI, not in React
router.use('/people', reactRoute || routePeople);
router.use('/repos', reactRoute || routeRepos);
router.use('/teams', reactRoute || routeTeams);
router.use('/unlink', routeUnlink);

// routes not in the frontend
router.use('/undo', routeUndo);

router.use('/', routeOrgs);

export default router;
