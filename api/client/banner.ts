//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { NextFunction, Response, Router } from 'express';
import { ReposAppRequest } from '../../interfaces';

import { jsonError } from '../../middleware';
import { getProviders } from '../../lib/transitional';

const router: Router = Router();

// TODO: move to modern w/administration experience, optionally

router.get('/', (req: ReposAppRequest, res: Response, next: NextFunction) => {
  const { config } = getProviders(req);
  const text = config?.serviceMessage?.banner || null;
  const link = config.serviceMessage?.link;
  const details = config.serviceMessage?.details;
  const banner = text ? { text, link, details } : null;
  return res.json({ banner });
});

router.use('*', (req, res: Response, next: NextFunction) => {
  return next(jsonError('no API or function available within this banner route', 404));
});

export default router;
