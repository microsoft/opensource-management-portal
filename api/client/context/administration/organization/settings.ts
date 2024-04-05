//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { NextFunction, Response, Router } from 'express';
import asyncHandler from 'express-async-handler';

import { OrganizationSetting } from '../../../../../business/entities/organizationSettings/organizationSetting';
import { ReposAppRequest } from '../../../../../interfaces';
import { jsonError } from '../../../../../middleware';
import { CreateError, ErrorHelper, getProviders } from '../../../../../lib/transitional';

const router: Router = Router();

interface IOrganizationSettings extends ReposAppRequest {
  dynamicSettings: OrganizationSetting;
}

router.use(
  asyncHandler(async (req: IOrganizationSettings, res: Response, next: NextFunction) => {
    const { organization } = req;
    const { organizationSettingsProvider } = getProviders(req);
    try {
      const dynamicSettings = await organizationSettingsProvider.getOrganizationSetting(
        String(organization.id)
      );
      req.dynamicSettings = dynamicSettings;
    } catch (error) {
      console.warn(error);
    }
    return next();
  })
);

router.get(
  '/',
  asyncHandler(async (req: IOrganizationSettings, res: Response, next: NextFunction) => {
    const { dynamicSettings } = req;
    return res.json({
      dynamicSettings,
    }) as unknown as void;
  })
);

router.delete(
  '/',
  asyncHandler(async function (req: IOrganizationSettings, res: Response) {
    const { dynamicSettings } = req;
    const { organizationId } = dynamicSettings;
    const { organizationSettingsProvider, queryCache } = getProviders(req);
    const orgName = req.query.deleteOrganizationConfiguration as string;
    if (orgName?.toLowerCase() !== dynamicSettings.organizationName.toLowerCase()) {
      throw CreateError.InvalidParameters(
        'The organization name provided does not match the organization name in the configuration.'
      );
    }
    await organizationSettingsProvider.deleteOrganizationSetting(dynamicSettings);
    res.status(204);
    if (queryCache) {
      queryCache.removeOrganizationById(String(organizationId));
    }
    return res.end() as unknown as void;
  })
);

// -- features

router.get(
  '/features',
  asyncHandler(async (req: IOrganizationSettings, res: Response, next: NextFunction) => {
    const { dynamicSettings, organization } = req;
    const { features } = dynamicSettings;
    return res.json({
      features,
      organizationName: organization.name,
    }) as unknown as void;
  })
);

router.get(
  '/feature/:flag',
  asyncHandler(async (req: IOrganizationSettings, res: Response, next: NextFunction) => {
    const { dynamicSettings, organization } = req;
    const flag = req.params.flag as string;
    return res.json({
      flag,
      value: dynamicSettings.features.includes(flag) ? flag : null,
      organizationName: organization.name,
    }) as unknown as void;
  })
);

router.put(
  '/feature/:flag',
  asyncHandler(async (req: IOrganizationSettings, res: Response, next: NextFunction) => {
    const { dynamicSettings, organization } = req;
    const { insights, organizationSettingsProvider } = getProviders(req);
    const { features } = dynamicSettings;
    const flag = req.params.flag as string;
    const restart = req.query.restart === '1';
    insights?.trackEvent({
      name: 'AddOrganizationFeatureFlag',
      properties: {
        flag,
        restart,
        currentFeatureFlags: features.join(', '),
      },
    });
    // special case
    if (flag === 'active') {
      if (dynamicSettings.active) {
        return next(CreateError.InvalidParameters('The organization is already active.'));
      }
      dynamicSettings.active = true;
    } else {
      if (features.includes(flag)) {
        return next(jsonError(`flag "${flag}" is already set`, 400));
      }
      dynamicSettings.features.push(flag);
    }
    try {
      if (restart) {
        dynamicSettings.updated = new Date();
      }
      await organizationSettingsProvider.updateOrganizationSetting(dynamicSettings);
    } catch (error) {
      return next(jsonError(`error adding flag "${flag}": ${error}`, ErrorHelper.GetStatus(error) || 400));
    }
    return res.json({
      flag,
      value: dynamicSettings.features.includes(flag) ? flag : null,
      restart,
      organizationName: organization.name,
    }) as unknown as void;
  })
);

router.delete(
  '/feature/:flag',
  asyncHandler(async (req: IOrganizationSettings, res: Response, next: NextFunction) => {
    const { organization, dynamicSettings } = req;
    const { organizationSettingsProvider, insights } = getProviders(req);
    const { features } = dynamicSettings;
    const flag = req.params.flag as string;
    const restart = req.query.restart === '1';
    insights?.trackEvent({
      name: 'RemoveOrganizationFeatureFlag',
      properties: {
        flag,
        restart,
        currentFeatureFlags: features.join(', '),
      },
    });
    if (flag === 'active') {
      if (!dynamicSettings.active) {
        return next(CreateError.InvalidParameters('The organization is already inactive.'));
      }
      dynamicSettings.active = false;
    } else {
      if (!features.includes(flag)) {
        return next(jsonError(`flag "${flag}" is not set`, 400));
      }
      dynamicSettings.features = dynamicSettings.features.filter((flagEntry) => flagEntry !== flag);
    }
    try {
      if (restart) {
        dynamicSettings.updated = new Date();
      }
      await organizationSettingsProvider.updateOrganizationSetting(dynamicSettings);
    } catch (error) {
      return next(jsonError(`error removing flag "${flag}": ${error}`, ErrorHelper.GetStatus(error) || 400));
    }
    return res.json({
      flag,
      value: dynamicSettings.features.includes(flag) ? flag : null,
      restart,
      organizationName: organization.name,
    }) as unknown as void;
  })
);

// -- properties

router.get(
  '/properties',
  asyncHandler(async (req: IOrganizationSettings, res: Response, next: NextFunction) => {
    const { dynamicSettings, organization } = req;
    const { properties } = dynamicSettings;
    return res.json({
      properties,
      organizationName: organization.name,
    }) as unknown as void;
  })
);

router.get(
  '/property/:flag',
  asyncHandler(async (req: IOrganizationSettings, res: Response, next: NextFunction) => {
    const { dynamicSettings, organization } = req;
    const propertyName = req.params.propertyName as string;
    const { properties } = dynamicSettings;
    return res.json({
      property: propertyName,
      value: properties[propertyName] || null,
      organizationName: organization.name,
    }) as unknown as void;
  })
);

router.put(
  '/property/:propertyName',
  asyncHandler(async (req: IOrganizationSettings, res: Response, next: NextFunction) => {
    const { organization, dynamicSettings } = req;
    const { insights, organizationSettingsProvider } = getProviders(req);
    const { properties } = dynamicSettings;
    const newValue = req.body.value as string;
    const restart = req.query.restart === '1';
    if (!newValue) {
      return next(jsonError('body.value required', 400));
    }
    if (typeof newValue !== 'string') {
      return next(jsonError('body.value must be a string value', 400));
    }
    const propertyName = req.params.propertyName as string;
    const currentPropertyValue = properties[propertyName] || null;
    insights?.trackEvent({
      name: 'SetOrganizationSettingProperty',
      properties: {
        propertyName,
        restart,
        currentProperties: JSON.stringify(properties),
        currentPropertyValue,
      },
    });
    const updateDescription = `Changing property ${propertyName} value from "${currentPropertyValue}" to "${newValue}"`;
    dynamicSettings.properties[propertyName] = newValue;
    try {
      if (restart) {
        dynamicSettings.updated = new Date();
      }
      await organizationSettingsProvider.updateOrganizationSetting(dynamicSettings);
    } catch (error) {
      return next(
        jsonError(
          `error setting property "${propertyName}" to "${newValue}": ${error}`,
          ErrorHelper.GetStatus(error) || 400
        )
      );
    }
    return res.json({
      property: propertyName,
      value: properties[propertyName] || null,
      organizationName: organization.name,
      dynamicSettings,
      restart,
      updateDescription,
    }) as unknown as void;
  })
);

router.delete(
  '/property/:propertyName',
  asyncHandler(async (req: IOrganizationSettings, res: Response, next: NextFunction) => {
    const { organization, dynamicSettings } = req;
    const { organizationSettingsProvider, insights } = getProviders(req);
    const { properties } = dynamicSettings;
    const propertyName = req.params.propertyName as string;
    const currentPropertyValue = properties[propertyName] || null;
    const restart = req.query.restart === '1';
    insights?.trackEvent({
      name: 'RemoveOrganizationSettingProperty',
      properties: {
        propertyName,
        currentProperties: JSON.stringify(properties),
        currentPropertyValue,
        restart,
      },
    });
    if (properties[propertyName] === undefined) {
      return next(jsonError(`property "${propertyName}" is not set`, 400));
    }
    delete dynamicSettings.properties[propertyName];
    try {
      if (restart) {
        dynamicSettings.updated = new Date();
      }
      await organizationSettingsProvider.updateOrganizationSetting(dynamicSettings);
    } catch (error) {
      return next(
        jsonError(`error removing property "${propertyName}": ${error}`, ErrorHelper.GetStatus(error) || 400)
      );
    }
    return res.json({
      property: propertyName,
      value: properties[propertyName] || null,
      organizationName: organization.name,
      restart,
    }) as unknown as void;
  })
);

//

router.use('*', (req, res: Response, next: NextFunction) => {
  return next(jsonError('no API or function available in administration - organization', 404));
});

export default router;
