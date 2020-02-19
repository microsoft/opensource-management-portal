//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import express from 'express';
const router = express.Router();

import { webContextMiddleware } from '../middleware/business/setContext';

router.use('/api', require('./api'));

router.use(webContextMiddleware);

router.use('/thanks', require('./thanks'));
router.use('/myinfo', require('./diagnostics'));
router.use('/explore', require('./explore'));
router.use('/approvals', require('./approvals'));

router.use(require('./index-authenticated'));

module.exports = router;
