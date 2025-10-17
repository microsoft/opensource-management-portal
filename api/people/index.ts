//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { NextFunction, Response, Router } from 'express';

import { json404 } from '../../middleware/jsonError.js';

const router: Router = Router();

import LinksRoute from './links.js';
import UnlinkRoute from './unlink.js';

router.use('/links', LinksRoute);
router.use('/unlink', UnlinkRoute);

router.use(json404);

export default router;
