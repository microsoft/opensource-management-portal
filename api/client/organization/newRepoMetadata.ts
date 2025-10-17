//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { NextFunction, Response, Router } from 'express';

import { jsonError } from '../../../middleware/jsonError.js';
import { ReposAppRequest } from '../../../interfaces/index.js';

const router: Router = Router();

router.get('/', async (req: ReposAppRequest, res: Response, next: NextFunction) => {
  const { organization } = req;
  const metadata = organization.getRepositoryCreateMetadata();
  res.json(metadata);
});

router.get('/byProjectReleaseType', async (req: ReposAppRequest, res: Response, next: NextFunction) => {
  const { organization } = req;
  const options = {
    projectType: req.query.projectType,
  };
  const metadata = organization.getRepositoryCreateMetadata(options);
  res.json(metadata);
});

router.use('/*splat', (req, res: Response, next: NextFunction) => {
  return next(jsonError('no API or function available within this path', 404));
});

export default router;
