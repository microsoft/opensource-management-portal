//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import express from 'express';

import { json404 } from '../../middleware/jsonError';

const router = express.Router();

import LinksRoute from './links';
import UnlinkRoute from './unlink';

router.use('/links', LinksRoute);
router.use('/unlink', UnlinkRoute);

router.use(json404);

export default router;
