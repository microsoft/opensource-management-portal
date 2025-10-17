//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { NextFunction, Response, Router } from 'express';

import { ReposAppRequest } from '../../../interfaces/index.js';
import { CreateError, getProviders } from '../../../lib/transitional.js';
import { getUserSettings } from '../../../middleware/business/userSettings.js';

import type { ReposAppRequestWithUserSettings } from '../../../interfaces/middleware.js';

const router: Router = Router();

router.use(getUserSettings);

router.get('/', async (req: ReposAppRequestWithUserSettings, res: Response, next: NextFunction) => {
  const { userSettings } = req;
  return res.json(userSettings || {}) as unknown as any;
});

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
router.post('/publicDataSharing/optIn', setPublicDataSharingValue.bind(null, true));
router.post('/publicDataSharing/optOut', setPublicDataSharingValue.bind(null, false));

router.use('/*splat', (req: ReposAppRequest, res: Response, next: NextFunction) => {
  return next(CreateError.NotFound('Contextual API route not found: /settings'));
});

export default router;
