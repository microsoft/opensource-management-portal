//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { NextFunction, Response, Router } from 'express';

import { CreateError, getProviders } from '../../../../lib/transitional.js';
import { OrganizationSetting } from '../../../../business/entities/organizationSettings/organizationSetting.js';
import { AdministrativeGitHubAppInstallationResponse, RequestWithInstallation } from './types.js';
import { IGitHubAppInstallation, IProviders } from '../../../../interfaces/index.js';
import GitHubApplication from '../../../../business/application.js';

const router: Router = Router();

router.use(async function (req: RequestWithInstallation, res: Response, next: NextFunction) {
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

  const staticSettings = operations.getOrganizationSettingsInstance(organizationName);
  req.organizationStaticSettings = staticSettings;

  return next();
});

router.get('/', async (req: RequestWithInstallation, res: Response, next: NextFunction) => {
  const { gitHubApplication, installation, organizationDynamicSettings } = req;
  const response: AdministrativeGitHubAppInstallationResponse = {
    app: gitHubApplication.asClientJson(),
    installation,
    installationId: installation.id,
    dynamicSettings: organizationDynamicSettings,
  };
  return res.json(response) as unknown as void;
});

// --- Forcefully removing an installation ---

router.delete('/', async (req: RequestWithInstallation, res: Response, next: NextFunction) => {
  const { gitHubApplication, installation, organizationDynamicSettings } = req;
  if (organizationDynamicSettings) {
    const { installations } = organizationDynamicSettings;
    if (installations.length === 1 && installations[0].installationId === installation.id) {
      throw CreateError.InvalidParameters(
        'The last installation cannot be removed without deleting the last remaining organization settings first for ' +
          (installation?.account?.login || 'unknown org') +
          '.'
      );
    }
  }
  try {
    await gitHubApplication.deleteInstallation(installation.id);
  } catch (error) {
    return next(error);
  }
  return res.json({}) as unknown as void;
});

// --- Installation addition ---

async function addInstallationToSettings(
  providers: IProviders,
  organizationDynamicSettings: OrganizationSetting,
  gitHubApplication: GitHubApplication,
  installation: IGitHubAppInstallation,
  silent: boolean
): Promise<AdministrativeGitHubAppInstallationResponse> {
  const { organizationSettingsProvider } = providers;
  if (!organizationDynamicSettings) {
    throw CreateError.NotFound('No dynamic settings available for the organization.');
  }
  const installationId = installation.id;
  const hasInstallation = organizationDynamicSettings.installations.some(
    (i) => i.installationId === installationId && i.appId === gitHubApplication.id
  );
  if (hasInstallation) {
    throw CreateError.InvalidParameters('The installation is already present.');
  }
  organizationDynamicSettings.installations.push({
    appId: gitHubApplication.id,
    installationId,
  });
  if (!silent) {
    organizationDynamicSettings.updated = new Date();
  }
  await organizationSettingsProvider.updateOrganizationSetting(organizationDynamicSettings);
  const response: AdministrativeGitHubAppInstallationResponse = {
    app: gitHubApplication.asClientJson(),
    installationId: installation.id,
    dynamicSettings: organizationDynamicSettings,
  };
  return response;
}

router.post('/addInstallation', async (req: RequestWithInstallation, res: Response, next: NextFunction) => {
  const providers = getProviders(req);
  const { gitHubApplication, installation, organizationDynamicSettings } = req;
  const silent = req.query.silent === '1';
  try {
    const response = await addInstallationToSettings(
      providers,
      organizationDynamicSettings,
      gitHubApplication,
      installation,
      silent
    );
    return res.json(response) as unknown as void;
  } catch (error) {
    return next(error);
  }
});

// --- Activation and deactivation ---

async function changeInstallationActivation(
  providers: IProviders,
  organizationDynamicSettings: OrganizationSetting,
  gitHubApplication: GitHubApplication,
  installation: IGitHubAppInstallation,
  newState: 'active' | 'inactive',
  silent: boolean
): Promise<AdministrativeGitHubAppInstallationResponse> {
  const { organizationSettingsProvider } = providers;
  if (!organizationDynamicSettings) {
    throw CreateError.NotFound('No dynamic settings available for the organization.');
  }
  if (organizationDynamicSettings.active === true && newState === 'active') {
    throw CreateError.InvalidParameters('The organization is already active.');
  } else if (organizationDynamicSettings.active === false && newState === 'inactive') {
    throw CreateError.InvalidParameters('The organization is already deactivated.');
  }
  organizationDynamicSettings.active = newState === 'active';
  if (!silent) {
    organizationDynamicSettings.updated = new Date();
  }
  await organizationSettingsProvider.updateOrganizationSetting(organizationDynamicSettings);
  const response: AdministrativeGitHubAppInstallationResponse = {
    app: gitHubApplication.asClientJson(),
    installationId: installation.id,
    dynamicSettings: organizationDynamicSettings,
  };
  return response;
}

router.post('/activate', async (req: RequestWithInstallation, res: Response, next: NextFunction) => {
  const providers = getProviders(req);
  const { gitHubApplication, installation, organizationDynamicSettings } = req;
  const silent = req.query.silent === '1';
  try {
    const response = await changeInstallationActivation(
      providers,
      organizationDynamicSettings,
      gitHubApplication,
      installation,
      'active',
      silent
    );
    return res.json(response) as unknown as void;
  } catch (error) {
    return next(error);
  }
});

router.post('/deactivate', async (req: RequestWithInstallation, res: Response, next: NextFunction) => {
  const providers = getProviders(req);
  const { gitHubApplication, installation, organizationDynamicSettings } = req;
  const silent = req.query.silent === '1';
  try {
    const response = await changeInstallationActivation(
      providers,
      organizationDynamicSettings,
      gitHubApplication,
      installation,
      'inactive',
      silent
    );
    return res.json(response) as unknown as void;
  } catch (error) {
    return next(error);
  }
});

router.use('/*splat', (req, res: Response, next: NextFunction) => {
  return next(
    CreateError.NotFound(
      'no API or function available: context/administration/apps/:appId/installations/:installationId'
    )
  );
});

export default router;
