//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { NextFunction, Response, Router } from 'express';
const router: Router = Router();

import { webContextMiddleware } from '../middleware/business/setContext';

import clientApiRoute from '../api/client';

import ThanksRoute from './thanks';
import MyInfoRoute from './diagnostics';
import ExploreRoute from './explore';
import ApprovalsRoute from './approvals';
import AuthenticatedRoute from './index-authenticated';

import { hasStaticReactClientApp } from '../lib/transitional';
import { injectReactClient } from '../middleware';

router.use('/api/client', clientApiRoute);

router.use(webContextMiddleware);

router.use('/thanks', ThanksRoute);
router.use('/myinfo', MyInfoRoute);

const hasReactApp = hasStaticReactClientApp();
const reactRoute = hasReactApp ? injectReactClient() : undefined;
router.use('/approvals', reactRoute || ApprovalsRoute); // redirects into settings for site users
router.use('/explore', reactRoute || ExploreRoute);

router.use(AuthenticatedRoute);

export default router;
