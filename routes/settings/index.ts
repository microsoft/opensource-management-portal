//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

// This feature is internal-only at this time. Assumes AAD-first auth scheme.

import express = require('express');
import asyncHandler from 'express-async-handler';
const router = express.Router();

import { ReposAppRequest, IProviders } from '../../transitional';
import { AddLinkToRequest } from '../../middleware/links/';
import { Operations } from '../../business/operations';
import { IMailAddressProvider } from '../../lib/mailAddressProvider';
import { ICorporateLink } from '../../business/corporateLink';

const approvalsRoute = require('./approvals');
const authorizationsRoute = require('./authorizations');
const digestReportsRoute = require('./digestReports');
const personalAccessTokensRoute = require('./personalAccessTokens');

import campaignsRoute from './campaigns';

router.use(asyncHandler(AddLinkToRequest));

router.get('/', asyncHandler( async (req: ReposAppRequest, res) => {
  const providers = req.app.settings.providers as IProviders;
  const link = req.individualContext.link;
  let legalContactInformation = null;
  try {
    if (providers.corporateContactProvider) {
      legalContactInformation = await providers.corporateContactProvider.lookupContacts(link.corporateUsername);
    }
  } catch (ignoredError) { /* ignored */ }
  req.individualContext.webContext.render({
    view: 'settings',
    title: 'Settings',
    state: {
      legalContactInformation,
      link,
    },
  });
}));

router.use('/approvals', approvalsRoute);
router.use('/authorizations', authorizationsRoute);
router.use('/campaigns', campaignsRoute);
router.use('/digestReports', digestReportsRoute);
router.use('/security/tokens', personalAccessTokensRoute);

module.exports = router;
