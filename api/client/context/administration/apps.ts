//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { NextFunction, Response, Router } from 'express';
import asyncHandler from 'express-async-handler';

import { ReposAppRequest } from '../../../../interfaces';
import { CreateError, getProviders } from '../../../../lib/transitional';

import routeIndividualApp from './app';
import GitHubApplication from '../../../../business/application';
import { sortByCaseInsensitive } from '../../../../lib/utils';
import {
  ApiRequestWithGitHubApplication,
  ManagedOrganizationAppConfigurationsByOrgView,
  ManagedOrganizationStatus,
} from './types';

const router: Router = Router();

router.get(
  '/',
  asyncHandler(async (req: ReposAppRequest, res: Response) => {
    const { operations, organizationSettingsProvider } = getProviders(req);
    const apps = operations.getApplications();
    const byOrg = new Map<string, ManagedOrganizationAppConfigurationsByOrgView>();
    function getOrg(name: string) {
      let o = byOrg.get(name);
      if (!o) {
        o = {
          organizationName: name,
          id: undefined,
          status: ManagedOrganizationStatus.NotAdopted,
          appInstallations: new Map(),
          dynamicSettings: null,
          configuredInstallations: [],
        };
        for (const app of apps) {
          o.appInstallations.set(app.id, null);
        }
        byOrg.set(name, o);
      }
      return o;
    }
    for (const app of apps) {
      const appInstalls = await app.getInstallations({ maxAgeSeconds: 5 });
      const { valid: validInstallations } = GitHubApplication.filterInstallations(appInstalls);
      for (const valid of validInstallations) {
        const organizationName = valid.account.login;
        const o = getOrg(organizationName.toLowerCase());
        o.appInstallations.set(app.id, {
          app,
          installationId: valid.id,
        });
        o.id = Number(valid.target_id);
        if (!o.dynamicSettings && valid.target_type === 'Organization') {
          try {
            o.dynamicSettings = await organizationSettingsProvider.getOrganizationSetting(
              valid.target_id.toString()
            );
          } catch (ignore) {
            /* ignored */
          }
          if (o.dynamicSettings) {
            o.configuredInstallations = o.dynamicSettings.installations.map(
              (install) => install.installationId
            );
            o.status = ManagedOrganizationStatus.Adopted;
          }
          if (o.dynamicSettings && o.dynamicSettings.active === true) {
            o.status = ManagedOrganizationStatus.Active;
          }
        }
      }
    }
    for (const organization of operations.organizations.values()) {
      const anOrg = getOrg(organization.name.toLowerCase());
      anOrg.id = organization.id;
    }
    const orgNames = Array.from(byOrg.keys()).sort(sortByCaseInsensitive);
    return res.json({
      apps: apps.map((app) => app.asClientJson()),
      orgNames,
      orgs: Array.from(byOrg.values()).map((data) => {
        return {
          name: data.organizationName,
          status: data.status,
          id: data.id,
          configuredInstallations: data.configuredInstallations,
          hasDynamicSettings: !!data.dynamicSettings,
          appInstallations: Array.from(data.appInstallations.keys())
            .filter((a) => a)
            .map((appIdKey) => {
              const install = data.appInstallations.get(appIdKey);
              return {
                installationId: install?.installationId,
                appId: install?.app?.id,
              };
            }),
        };
      }),
    }) as unknown as void;
  })
);

router.use(
  '/:appId',
  asyncHandler(async function (req: ApiRequestWithGitHubApplication, res: Response, next: NextFunction) {
    const { operations } = getProviders(req);
    const appId = Number(req.params.appId);
    const app = operations.getApplicationById(appId);
    if (app) {
      req.gitHubApplication = app;
      return next();
    }
    return next(CreateError.NotFound('no app available with that ID'));
  })
);

router.use('/:appId', routeIndividualApp);

router.use('*', (req, res: Response, next: NextFunction) => {
  return next(CreateError.NotFound('no API or function available: context/administration/apps'));
});

export default router;
