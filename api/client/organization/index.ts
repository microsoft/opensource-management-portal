//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { Router } from 'express';
import asyncHandler from 'express-async-handler';

import { ReposAppRequest } from '../../../interfaces';
import { jsonError } from '../../../middleware';
import getCompanySpecificDeployment from '../../../middleware/companySpecificDeployment';
import { getProviders } from '../../../transitional';
import {
  blockIfUnmanagedOrganization,
  IReposAppRequestWithOrganizationManagementType,
  OrganizationManagementType,
} from '../../../middleware/business/organization';

import routeRepos from './repos';
import routeTeams from './teams';
import routePeople from './people';
import routeNewRepoMetadata from './newRepoMetadata';
import routeAnnotations from './annotations';

const router: Router = Router();

const deployment = getCompanySpecificDeployment();
deployment?.routes?.api?.organization?.index && deployment?.routes?.api?.organization?.index(router);

router.get(
  '/accountDetails',
  asyncHandler(async (req: IReposAppRequestWithOrganizationManagementType, res) => {
    const { organization, organizationProfile, organizationManagementType } = req;
    if (organizationManagementType === OrganizationManagementType.Unmanaged) {
      return res.json(organizationProfile);
    }
    const entity = organization.getEntity();
    if (entity) {
      return res.json(entity);
    }
    const details = await organization.getDetails();
    return res.json(details);
  })
);

/*
asClientJson() {
    // TEMP: TEMP: TEMP: not long-term as currently designed
    const values = {
      active: this.active,
      createRepositoriesOnGitHub: this.createRepositoriesOnGitHub,
      description: this.description,
      externalMembersPermitted: this.externalMembersPermitted,
      id: this.id,
      locked: this.locked,
      hidden: this.hidden,
      appOnly: this.isAppOnly,
      name: this.name,
      priority: this.priority,
      privateEngineering: this.privateEngineering,
      management: this.getManagementApproach(),
    };
*/
router.get(
  '/',
  asyncHandler(async (req: IReposAppRequestWithOrganizationManagementType, res, next) => {
    const { organization, organizationProfile, organizationManagementType } = req;
    if (organizationManagementType === OrganizationManagementType.Unmanaged) {
      return res.json({
        managementType: req.organizationManagementType,
        id: organizationProfile.id,
      });
    }
    return res.json({
      managementType: req.organizationManagementType,
      ...organization.asClientJson(),
    });
  })
);

router.use('/annotations', routeAnnotations);

router.use(blockIfUnmanagedOrganization);

router.use('/repos', routeRepos);
router.use('/teams', routeTeams);
router.use('/people', routePeople);
router.use('/newRepoMetadata', routeNewRepoMetadata);

router.get('/newRepoBanner', (req: ReposAppRequest, res) => {
  const { config } = getProviders(req);
  const newRepositoriesOffline = config?.github?.repos?.newRepositoriesOffline;
  return res.json({ newRepositoriesOffline });
});

router.use('*', (req, res, next) => {
  return next(jsonError('no API or function available', 404));
});

export default router;
