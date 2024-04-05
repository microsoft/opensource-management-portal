//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { NextFunction, Response, Router } from 'express';
import asyncHandler from 'express-async-handler';

import { Organization } from '../../../../business/organization';
import { ReposAppRequest } from '../../../../interfaces';
import { getIsCorporateAdministrator, jsonError } from '../../../../middleware';
import getCompanySpecificDeployment from '../../../../middleware/companySpecificDeployment';
import { ErrorHelper, getProviders } from '../../../../lib/transitional';

import routeIndividualOrganization from './organization';
import routeApps from './apps';

const router: Router = Router();

interface IRequestWithAdministration extends ReposAppRequest {
  isSystemAdministrator: boolean;
}

router.use(
  asyncHandler(async (req: IRequestWithAdministration, res: Response, next: NextFunction) => {
    req.isSystemAdministrator = await getIsCorporateAdministrator(req);
    return next();
  })
);

router.get(
  '/',
  asyncHandler(async (req: IRequestWithAdministration, res: Response) => {
    const { operations } = getProviders(req);
    const isAdministrator = req.isSystemAdministrator;
    if (!isAdministrator) {
      return res.json({
        isAdministrator,
      }) as unknown as void;
    }
    const organizations = operations.getOrganizations().map((org) => org.asClientJson());
    return res.json({
      isAdministrator,
      organizations,
    }) as unknown as void;
  })
);

router.use((req: IRequestWithAdministration, res: Response, next: NextFunction) => {
  return req.isSystemAdministrator ? next() : next(jsonError('Not authorized', 403));
});

router.use('/apps', routeApps);

router.use(
  '/organization/:orgName',
  asyncHandler(async (req: ReposAppRequest, res: Response, next: NextFunction) => {
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
  })
);

router.use('/organization/:orgName', routeIndividualOrganization);

const deployment = getCompanySpecificDeployment();
deployment?.routes?.api?.context?.administration?.index &&
  deployment?.routes?.api?.context.administration.index(router);

router.use('*', (req, res: Response, next: NextFunction) => {
  return next(jsonError('no API or function available: context/administration', 404));
});

export default router;
