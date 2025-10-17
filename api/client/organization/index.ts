//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { NextFunction, Response, Router } from 'express';

import { ReposAppRequest } from '../../../interfaces/index.js';
import { jsonError } from '../../../middleware/index.js';
import getCompanySpecificDeployment from '../../../middleware/companySpecificDeployment.js';
import { getProviders } from '../../../lib/transitional.js';
import {
  blockIfUnmanagedOrganization,
  IReposAppRequestWithOrganizationManagementType,
  OrganizationManagementType,
} from '../../../middleware/business/organization.js';

import routeRepos from './repos.js';
import routeTeams from './teams.js';
import routePeople from './people.js';
import routeNewRepoMetadata from './newRepoMetadata.js';
import routeAnnotations from './annotations.js';

const router: Router = Router();

const deployment = getCompanySpecificDeployment();
if (deployment?.routes?.api?.organization?.index) {
  deployment?.routes?.api?.organization?.index(router);
}

router.get('/accountDetails', async (req: IReposAppRequestWithOrganizationManagementType, res) => {
  const { organization, organizationProfile, organizationManagementType } = req;
  if (organizationManagementType === OrganizationManagementType.Unmanaged) {
    return res.json(organizationProfile) as unknown as void;
  }
  const entity = organization.getEntity();
  if (entity) {
    return res.json(entity) as unknown as void;
  }
  const details = await organization.getDetails();
  return res.json(details) as unknown as void;
});

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
  async (req: IReposAppRequestWithOrganizationManagementType, res: Response, next: NextFunction) => {
    const { organization, organizationProfile, organizationManagementType } = req;
    if (organizationManagementType === OrganizationManagementType.Unmanaged) {
      return res.json({
        managementType: req.organizationManagementType,
        id: organizationProfile.id,
      }) as unknown as void;
    }
    return res.json({
      managementType: req.organizationManagementType,
      ...organization.asClientJson(),
    }) as unknown as void;
  }
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
  return res.json({ newRepositoriesOffline }) as unknown as void;
});

router.use('/*splat', (req, res: Response, next: NextFunction) => {
  return next(jsonError('no API or function available', 404));
});

export default router;
