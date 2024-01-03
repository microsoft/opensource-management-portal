//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { NextFunction, Response, Router } from 'express';
import asyncHandler from 'express-async-handler';

import { ReposAppRequest } from '../../../interfaces';
import { CreateError, getProviders } from '../../../lib/transitional';
import { getUserSettings } from '../../../middleware/business/userSettings';

import type { ReposAppRequestWithUserSettings } from '../../../interfaces/middleware';

const router: Router = Router();

router.use(asyncHandler(getUserSettings));

router.get(
  '/',
  asyncHandler(async (req: ReposAppRequestWithUserSettings, res: Response, next: NextFunction) => {
    const { userSettings } = req;
    return res.json(userSettings || {}) as unknown as any;
  })
);

async function setPublicDataSharingValue(
  sharingOptOn: boolean,
  req: ReposAppRequestWithUserSettings,
  res: Response,
  next: NextFunction
) {
  const { userSettings } = req;
  const { userSettingsProvider } = getProviders(req);
  userSettings.contributionShareOptIn = sharingOptOn;
  await userSettingsProvider.updateUserSettings(userSettings);
  return res.status(201).json(userSettings || {}) as unknown as any;
}

// Actions as separate posts to keep the API simple
router.post('/publicDataSharing/optIn', asyncHandler(setPublicDataSharingValue.bind(null, true)));
router.post('/publicDataSharing/optOut', asyncHandler(setPublicDataSharingValue.bind(null, false)));

router.use('*', (req: ReposAppRequest, res: Response, next: NextFunction) => {
  return next(CreateError.NotFound('Contextual API route not found: /settings'));
});

export default router;
