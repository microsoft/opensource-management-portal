//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

import express from 'express';
import asyncHandler from 'express-async-handler';
const router = express.Router();

import { IProviders, ReposAppRequest } from '../../transitional';
import { asNumber } from '../../utils';
import { Operations } from '../../business/operations';

router.get('/', asyncHandler(async function (req: ReposAppRequest, res, next) {
  const providers = req.app.settings.providers as IProviders;
  const individualContext = req.individualContext;
  const orgNames = await providers.eventRecordProvider.queryDistinctOrganizations();
  individualContext.webContext.render({
    view: 'administration/contributingorgs',
    title: `contributing orgs`,
    state: {
      names: orgNames,
      officialNames: new Set(providers.operations.organizationNames),
    },
  });
}));

module.exports = router;
