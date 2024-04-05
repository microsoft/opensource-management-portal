//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { NextFunction, Response, Router } from 'express';
import asyncHandler from 'express-async-handler';
const router: Router = Router();

import { ErrorHelper, getProviders } from '../../lib/transitional';
import { UserSettings } from '../../business/entities/userSettings';
import { UserAlertType } from '../../interfaces';
import type { ReposAppRequestWithUserSettings } from '../../interfaces/middleware';
import { getUserSettings } from '../../middleware/business/userSettings';

function view(req: ReposAppRequestWithUserSettings, res) {
  const userSettings = req.userSettings;
  req.individualContext.webContext.render({
    view: 'settings/contributionData',
    title: 'Contribution data sharing',
    state: {
      userSettings,
    },
  });
}

router.use(asyncHandler(getUserSettings));

router.get('/', view);

router.post(
  '/',
  asyncHandler(async function (req: ReposAppRequestWithUserSettings, res: Response, next: NextFunction) {
    const isOptIn = !!(req.body.optIn === '1');
    const currentSetting = req.userSettings.contributionShareOptIn;
    req.userSettings.contributionShareOptIn = isOptIn;
    const changed = currentSetting !== isOptIn;
    if (!changed) {
      return next(new Error('No change to sharing setting.'));
    }
    const { userSettingsProvider } = getProviders(req);
    await userSettingsProvider.updateUserSettings(req.userSettings);
    const message = isOptIn
      ? 'You have opted in to sharing of contribution data.'
      : 'You have opted out of sharing contribution data.';
    const title = isOptIn ? 'Opt-in saved' : 'Opt-out';
    req.individualContext.webContext.saveUserAlert(message, title, UserAlertType.Success);
    return view(req, res);
  })
);

export default router;
