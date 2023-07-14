//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { Router } from 'express';
import asyncHandler from 'express-async-handler';
import { Organization } from '../../../../business/organization';
import { ReposAppRequest } from '../../../../interfaces';
import { getIsCorporateAdministrator, jsonError } from '../../../../middleware';
import getCompanySpecificDeployment from '../../../../middleware/companySpecificDeployment';
import { ErrorHelper, getProviders } from '../../../../transitional';

import routeIndividualOrganization from './organization';

const router: Router = Router();

interface IRequestWithAdministration extends ReposAppRequest {
  isSystemAdministrator: boolean;
}

router.use(
  asyncHandler(async (req: IRequestWithAdministration, res, next) => {
    req.isSystemAdministrator = await getIsCorporateAdministrator(req);
    return next();
  })
);

router.get(
  '/',
  asyncHandler(async (req: IRequestWithAdministration, res, next) => {
    const { operations } = getProviders(req);
    const isAdministrator = req.isSystemAdministrator;
    if (!isAdministrator) {
      return res.json({
        isAdministrator,
      });
    }
    const organizations = operations.getOrganizations().map((org) => org.asClientJson());
    return res.json({
      isAdministrator,
      organizations,
    });
  })
);

router.use((req: IRequestWithAdministration, res, next) => {
  return req.isSystemAdministrator ? next() : next(jsonError('Not authorized', 403));
});

router.use(
  '/organization/:orgName',
  asyncHandler(async (req: ReposAppRequest, res, next) => {
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
        return res.end();
      }
      return next(jsonError(noOrgError, 500));
    }
  })
);

router.use('/organization/:orgName', routeIndividualOrganization);

const deployment = getCompanySpecificDeployment();
deployment?.routes?.api?.context?.administration?.index &&
  deployment?.routes?.api?.context.administration.index(router);

router.use('*', (req, res, next) => {
  return next(jsonError('no API or function available: context/administration', 404));
});

export default router;
