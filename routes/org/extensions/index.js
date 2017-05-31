//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

const express = require('express');
const router = express.Router();

const npmExtensionRoute = require('./npm');

router.use('/npm', npmExtensionRoute);

module.exports = router;
