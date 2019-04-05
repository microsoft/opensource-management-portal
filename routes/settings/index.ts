//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

// This feature is internal-only at this time. Assumes AAD-first auth scheme.

import express = require('express');
import { ReposAppRequest } from '../../transitional';
const router = express.Router();

import { addLinkToRequest } from '../../middleware/links/';

const authorizationsRoute = require('./authorizations');
const digestReportsRoute = require('./digestReports');
const personalAccessTokensRoute = require('./personalAccessTokens');

router.use(addLinkToRequest);

router.get('/', (req: ReposAppRequest, res) => {
  req.individualContext.webContext.render({
    view: 'settings',
    title: 'Settings',
  });
});

router.use('/authorizations', authorizationsRoute);
router.use('/digestReports', digestReportsRoute);
router.use('/security/tokens', personalAccessTokensRoute);

module.exports = router;
