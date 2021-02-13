//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import express from 'express';
const router = express.Router();

import { webContextMiddleware } from '../middleware/business/setContext';

import ApiRoute from '../api';

router.use('/api', ApiRoute);

router.use(webContextMiddleware);

import ThanksRoute from './thanks';
import MyInfoRoute from './diagnostics';
import ExploreRoute from './explore';
import ApprovalsRoute from './approvals';
import AuthenticatedRoute from './index-authenticated';

router.use('/thanks', ThanksRoute);
router.use('/myinfo', MyInfoRoute);
router.use('/explore', ExploreRoute);

import { hasStaticReactClientApp } from '../transitional';
import { injectReactClient } from '../microsoft/preview';

const hasReactApp = hasStaticReactClientApp();
const reactRoute = hasReactApp ? injectReactClient() : undefined;
router.use('/approvals', reactRoute || ApprovalsRoute); // redirects into settings for site users

router.use(AuthenticatedRoute);

export default router;
