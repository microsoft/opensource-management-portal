//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

// This feature is internal-only at this time. Assumes AAD-first auth scheme.

import express = require('express');
import asyncHandler from 'express-async-handler';
const router = express.Router();

import { ReposAppRequest } from '../../transitional';
import { addLinkToRequest } from '../../middleware/links/';
import { Operations } from '../../business/operations';
import { IMailAddressProvider } from '../../lib/mailAddressProvider';
import { ICorporateLink } from '../../business/corporateLink';

const approvalsRoute = require('./approvals');
const authorizationsRoute = require('./authorizations');
const digestReportsRoute = require('./digestReports');
const personalAccessTokensRoute = require('./personalAccessTokens');

router.use(addLinkToRequest);

router.get('/', asyncHandler( async (req: ReposAppRequest, res) => {
  const operations = req.app.settings.operations as Operations;
  const link = req.individualContext.link;
  let legalContactInformation = null;
  try {
    legalContactInformation = await getLegalContact(operations.providers.mailAddressProvider, link);
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

router.use('/authorizations', authorizationsRoute);
router.use('/digestReports', digestReportsRoute);
router.use('/security/tokens', personalAccessTokensRoute);
router.use('/approvals', approvalsRoute);

function getLegalContact(mailAddressProvider: IMailAddressProvider, link: ICorporateLink): Promise<any> {
  return new Promise((resolve, reject) => {
    if (link && link.corporateUsername && mailAddressProvider && mailAddressProvider['getLegalContactInformationFromUpn']) {
      return mailAddressProvider['getLegalContactInformationFromUpn'](link.corporateUsername, (error, data) => {
        return error ? reject(error) : resolve(data);
      });
    } else {
      return resolve();
    }
  });
}

module.exports = router;
