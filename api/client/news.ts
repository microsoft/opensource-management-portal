//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { NextFunction, Response, Router } from 'express';
import asyncHandler from 'express-async-handler';

import { jsonError } from '../../middleware';
import { getProviders } from '../../lib/transitional';
import { ReposAppRequest } from '../../interfaces';

const router: Router = Router();

router.get(
  '/',
  asyncHandler(async (req: ReposAppRequest, res) => {
    const { config } = getProviders(req);
    return res.json({ articles: config?.news?.all || [] }) as unknown as void;
  })
);

router.use('*', (req: ReposAppRequest, res: Response, next: NextFunction) => {
  return next(jsonError('API or route not found within news', 404));
});

export default router;
