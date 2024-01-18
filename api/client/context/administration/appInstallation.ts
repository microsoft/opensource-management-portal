//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { NextFunction, Response, Router } from 'express';
import asyncHandler from 'express-async-handler';

import { CreateError, getProviders } from '../../../../lib/transitional';
import { OrganizationSetting } from '../../../../business/entities/organizationSettings/organizationSetting';
import { AdministrativeGitHubAppInstallationResponse, RequestWithInstallation } from './types';

const router: Router = Router();

router.use(
  asyncHandler(async function (req: RequestWithInstallation, res: Response, next: NextFunction) {
    const { operations, organizationSettingsProvider } = getProviders(req);

    const { installation } = req;
    const organizationId = installation.account.id;
    const organizationName = installation.account.login;
    let settings: OrganizationSetting = null;
    try {
      settings = await organizationSettingsProvider.getOrganizationSetting(organizationId.toString());
    } catch (notFound) {
      /* ignored */
    }
    req.organizationDynamicSettings = settings;

    const staticSettings = operations.getOrganizationSettings(organizationName);
    req.organizationStaticSettings = staticSettings;

    return next();
  })
);

router.get(
  '/',
  asyncHandler(async (req: RequestWithInstallation, res: Response, next: NextFunction) => {
    const { gitHubApplication, installation, organizationDynamicSettings, organizationStaticSettings } = req;
    const response: AdministrativeGitHubAppInstallationResponse = {
      app: gitHubApplication.asClientJson(),
      // installation,
      installationId: installation.id,
      dynamicSettings: organizationDynamicSettings,
    };
    return res.json(response) as unknown as void;
  })
);

router.use('*', (req, res: Response, next: NextFunction) => {
  return next(
    CreateError.NotFound(
      'no API or function available: context/administration/apps/:appId/installations/:installationId'
    )
  );
});

export default router;
