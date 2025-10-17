//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import querystring from 'querystring';
import { NextFunction, Response, Router } from 'express';

const router: Router = Router();

import { IReposRequestWithOrganization } from '../interfaces/index.js';
import { injectReactClient, TryFallbackToBlob } from '../middleware/index.js';
import { getProviders, hasStaticReactClientApp } from '../lib/transitional.js';
import { wrapError } from '../lib/utils.js';

import orgRoute from './org//index.js';

const hasReactApp = hasStaticReactClientApp();
const reactRoute = hasReactApp ? injectReactClient() : undefined;

if (hasReactApp) {
  router.use('/orgs', reactRoute);
  router.use('/orgs/:orgName', forwardToOrganizationRoutes);
}

router.use('/:orgName', forwardToOrganizationRoutes);

async function forwardToOrganizationRoutes(
  req: IReposRequestWithOrganization,
  res: Response,
  next: NextFunction
) {
  // This middleware contains both the original GitHub operations types
  // as well as the newer implementation. In time this will peel apart.
  const orgName = req.params.orgName;
  const { insights, operations } = getProviders(req);
  try {
    const organization = operations.getOrganization(orgName);
    req.organization = organization;
    if (hasReactApp && !req.path.includes('/byClient') /* special case */) {
      const remainingPath = req.path;
      let q = querystring.stringify(req.query as any);
      q = q ? `?${q}` : '';
      const reactClientPath = `/orgs/${organization.name}${remainingPath}${q}`;
      console.log(`redirecting org route to react client route: ${reactClientPath}`);
      return res.redirect(reactClientPath);
    }
    return next();
  } catch (ex) {
    if (orgName.toLowerCase() == 'account') {
      return res.redirect('/');
    }
    if (hasReactApp) {
      const isComplete = await TryFallbackToBlob(req, res);
      if (isComplete) {
        return;
      }
    }
    const err = wrapError(null, 'Organization not found', true);
    err.status = 404;
    insights?.trackException({
      exception: err,
      properties: {
        name: 'route.orgs.not_found',
        orgName,
        fullBaseUrl: req.baseUrl,
        fullUrl: req.url,
        fullOriginalUrl: req.originalUrl,
        method: req.method,
      },
    });
    return next(err);
  }
}

router.use('/:orgName', orgRoute);

export default router;
