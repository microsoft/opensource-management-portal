//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

import express = require('express');

import { json404 } from '../../../middleware/jsonError';

const router = express.Router();

router.use('/links', require('./links'));
router.use('/unlink', require('./unlink'));

router.use(json404);

module.exports = router;
