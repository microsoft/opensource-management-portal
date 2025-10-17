//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { Router } from 'express';
const router: Router = Router();

import bodyParser from 'body-parser';

import { webContextMiddleware } from '../middleware/business/setContext.js';

import routeAuthenticatedRoutes from './index-authenticated.js';
import routeClientApi from '../api/client/index.js';
import routeMyInfo from './diagnostics.js';

router.use('/api/client', /* API routes provide their own parser */ bodyParser.json(), routeClientApi);

router.use(webContextMiddleware);

router.use('/myinfo', routeMyInfo);

router.use(routeAuthenticatedRoutes);

export default router;
