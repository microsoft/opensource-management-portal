//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { NextFunction, Response, Router } from 'express';
const router: Router = Router();

import approvalsRoute from './approvals.js';
import authorizationsRoute from './authorizations.js';

import contributionDataRoute from './contributionData.js';
import campaignsRoute from './campaigns.js';
import { tryAddLinkToRequest } from '../../middleware/index.js';
import { ReposAppRequest } from '../../interfaces/index.js';

router.use(tryAddLinkToRequest);

router.get('/', async (req: ReposAppRequest, res) => {
  const link = req.individualContext.link;
  req.individualContext.webContext.render({
    view: 'settings',
    title: 'Settings',
    state: {
      link,
    },
  });
});

router.use('/approvals', approvalsRoute);
router.use('/authorizations', authorizationsRoute);
router.use('/campaigns', campaignsRoute);
router.use('/contributionData', contributionDataRoute);

export default router;
