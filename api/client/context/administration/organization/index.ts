//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { NextFunction, Response, Router } from 'express';
import asyncHandler from 'express-async-handler';

import { ReposAppRequest } from '../../../../../interfaces';
import { jsonError } from '../../../../../middleware';

import routeSettings from './settings';

const router: Router = Router();

router.use('/settings', routeSettings);

router.get(
  '/',
  asyncHandler(async (req: ReposAppRequest, res: Response, next: NextFunction) => {
    const { organization } = req;
    return res.json({
      organization: organization.asClientJson(),
    }) as unknown as void;
  })
);

router.use('*', (req, res: Response, next: NextFunction) => {
  return next(jsonError('no API or function available in administration - organization', 404));
});

export default router;
