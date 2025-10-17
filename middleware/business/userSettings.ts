//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import type { NextFunction, Response } from 'express';

import type { ReposAppRequestWithUserSettings } from '../../interfaces/middleware.js';

import { UserSettings } from '../../business/entities/userSettings.js';
import { ErrorHelper, getProviders } from '../../lib/transitional.js';
import { IndividualContext } from '../../business/user/index.js';

export async function getUserSettings(
  req: ReposAppRequestWithUserSettings,
  res: Response,
  next: NextFunction
) {
  const activeContext = (req.individualContext || req.apiContext) as IndividualContext;
  const corporateId = activeContext?.corporateIdentity?.id;
  const { userSettingsProvider } = getProviders(req);
  if (corporateId && !req.userSettings) {
    let settings: UserSettings = null;
    try {
      settings = await userSettingsProvider.getUserSettings(corporateId);
    } catch (notFoundError) {
      if (ErrorHelper.IsNotFound(notFoundError)) {
        // ignore
      } else {
        throw notFoundError;
      }
    }
    if (!settings) {
      settings = new UserSettings();
      settings.corporateId = corporateId;
      await userSettingsProvider.insertUserSettings(settings);
    }
    req.userSettings = settings;
  }
  return next();
}
