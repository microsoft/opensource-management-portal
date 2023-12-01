//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { Router } from 'express';
import asyncHandler from 'express-async-handler';
import { ReposAppRequest } from '../../../../../interfaces';
import { jsonError } from '../../../../../middleware';

import routeSettings from './settings';

const router: Router = Router();

router.use('/settings', routeSettings);

router.get(
  '/',
  asyncHandler(async (req: ReposAppRequest, res, next) => {
    const { organization } = req;
    return res.json({
      organization: organization.asClientJson(),
    });
  })
);

router.use('*', (req, res, next) => {
  return next(jsonError('no API or function available in administration - organization', 404));
});

export default router;
