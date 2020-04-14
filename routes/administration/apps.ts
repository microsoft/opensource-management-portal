//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

import express from 'express';
import asyncHandler from 'express-async-handler';
const router = express.Router();

import { IProviders, ReposAppRequest } from '../../transitional';
import { sortByCaseInsensitive, asNumber } from '../../utils';
import GitHubApplication from '../../business/application';
import { OrganizationSetting } from '../../entities/organizationSettings/organizationSetting';

interface IByOrgViewAppInstallation {
  app: GitHubApplication;
  installationId?: number;
}

enum OrgStatus {
  Active = 'Active',
  Adopted = 'Adopted',
  NotAdopted = 'NotAdopted',
}

interface IByOrgView {
  organizationName: string;
  status: OrgStatus;
  appInstallations: Map<number, IByOrgViewAppInstallation>;
  dynamicSettings: OrganizationSetting,
  configuredInstallations: number[],
  id?: number;
}

router.get('/', asyncHandler(async function (req: ReposAppRequest, res, next) {
  const providers = req.app.settings.providers as IProviders;
  const operations = providers.operations;
  const apps = providers.operations.getApplications();
  const individualContext = req.individualContext;
  const organizationSettingsProvider = providers.organizationSettingsProvider;
  const byOrg = new Map<string, IByOrgView>();
  function getOrg(name: string) {
    let o = byOrg.get(name);
    if (!o) {
      o = {
        organizationName: name,
        id: undefined,
        status: OrgStatus.NotAdopted,
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
    const { valid } = GitHubApplication.filterInstallations(appInstalls);
    for (const vi of valid) {
      const organizationName = vi.account.login;
      const o = getOrg(organizationName.toLowerCase());
      o.appInstallations.set(app.id, {
        app,
        installationId: vi.id,
      });
      o.id = asNumber(vi.target_id);
      if (!o.dynamicSettings && vi.target_type === 'Organization') {
        try {
          o.dynamicSettings = await organizationSettingsProvider.getOrganizationSetting(vi.target_id.toString());
        } catch (ignore) { /* ignored */ }
        if (o.dynamicSettings) {
          o.configuredInstallations = o.dynamicSettings.installations.map(install => install.installationId);
          o.status = OrgStatus.Adopted;
        }
        if (o.dynamicSettings && o.dynamicSettings.active === true) {
          o.status = OrgStatus.Active;
        }
      }
    }
  }
  for (const organization of operations.organizations.values()) {
    const anOrg = getOrg(organization.name.toLowerCase());
    anOrg.id = organization.id;
  }
  const orgs = byOrg;
  const orgNames = Array.from(byOrg.keys()).sort(sortByCaseInsensitive);
  individualContext.webContext.render({
    view: 'administration/setup/apps',
    title: `GitHub Applications`,
    state: {
      apps,
      orgNames,
      orgs,
    },
  });
}));

module.exports = router;
