//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

// This feature is internal-only at this time. Assumes AAD-first auth scheme.

const express = require('express');
const router = express.Router();

const authorizationsRoute = require('./authorizations');
const digestReportsRoute = require('./digestReports');
const npmRoute = require('./npm');

const addLinkToMiddleware = require('../../middleware/links/');

router.use(addLinkToMiddleware);

router.get('/', (req, res) => {
  req.legacyUserContext.render(req, res, 'settings', 'Settings', {});
});

router.use('/authorizations', authorizationsRoute);
router.use('/digestReports', digestReportsRoute);
router.use('/npm', npmRoute);

module.exports = router;
