//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { NextFunction, Response, Router } from 'express';

import { ReposAppRequest } from '../../../../../interfaces/index.js';
import { jsonError } from '../../../../../middleware/index.js';

import routeSettings from './settings.js';

const router: Router = Router();

router.use('/settings', routeSettings);

router.get('/', async (req: ReposAppRequest, res: Response, next: NextFunction) => {
  const { organization } = req;
  return res.json({
    organization: organization.asClientJson(),
  }) as unknown as void;
});

router.use('/*splat', (req, res: Response, next: NextFunction) => {
  return next(jsonError('no API or function available in administration - organization', 404));
});

export default router;
