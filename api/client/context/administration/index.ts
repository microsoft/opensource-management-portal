//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { NextFunction, Response, Router } from 'express';

import { Organization } from '../../../../business/organization.js';
import { ReposAppRequest } from '../../../../interfaces/index.js';
import { getIsCorporateAdministrator, jsonError } from '../../../../middleware/index.js';
import getCompanySpecificDeployment from '../../../../middleware/companySpecificDeployment.js';
import { ErrorHelper, getProviders } from '../../../../lib/transitional.js';

import routeIndividualOrganization from './organization/index.js';
import routeApps from './apps.js';

const router: Router = Router();

interface IRequestWithAdministration extends ReposAppRequest {
  isSystemAdministrator: boolean;
}

router.use(async (req: IRequestWithAdministration, res: Response, next: NextFunction) => {
  req.isSystemAdministrator = await getIsCorporateAdministrator(req);
  return next();
});

router.get('/', async (req: IRequestWithAdministration, res: Response) => {
  const { operations } = getProviders(req);
  const isAdministrator = req.isSystemAdministrator;
  if (!isAdministrator) {
    return res.json({
      isAdministrator,
    }) as unknown as void;
  }
  const organizations = operations.getOrganizationsIncludingInvisible().map((org) => org.asClientJson());
  return res.json({
    isAdministrator,
    organizations,
  }) as unknown as void;
});

router.use((req: IRequestWithAdministration, res: Response, next: NextFunction) => {
  return req.isSystemAdministrator ? next() : next(jsonError('Not authorized', 403));
});

router.use('/apps', routeApps);

router.use('/organization/:orgName', async (req: ReposAppRequest, res: Response, next: NextFunction) => {
  const { orgName } = req.params;
  const { operations } = getProviders(req);
  let organization: Organization = null;
  try {
    organization = operations.getOrganization(orgName);
    req.organization = organization;
    return next();
  } catch (noOrgError) {
    if (ErrorHelper.IsNotFound(noOrgError)) {
      res.status(404);
      res.end();
      return;
    }
    return next(jsonError(noOrgError, 500));
  }
});

router.use('/organization/:orgName', routeIndividualOrganization);

const deployment = getCompanySpecificDeployment();
if (deployment?.routes?.api?.context?.administration?.index) {
  deployment?.routes?.api?.context.administration.index(router);
}

router.use('/*splat', (req, res: Response, next: NextFunction) => {
  return next(jsonError('no API or function available: context/administration', 404));
});

export default router;
