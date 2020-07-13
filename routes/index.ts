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

router.use('/thanks', ThanksRoute);
router.use('/myinfo', MyInfoRoute);
router.use('/explore', ExploreRoute);
router.use('/approvals', ApprovalsRoute);

import AuthenticatedRoute from './index-authenticated';
router.use(AuthenticatedRoute);

export default router;
