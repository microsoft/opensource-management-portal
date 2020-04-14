//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import express = require('express');
import asyncHandler from 'express-async-handler';
const router = express.Router();

import { ReposAppRequest, IProviders, CreateError } from '../../transitional';

router.use('/:campaignGroupId', (req:  ReposAppRequest, res: any, next) => {
  const { config } = req.app.settings.providers as IProviders;
  const knownCampaignGroups = (config?.campaigns?.groups || '').toLowerCase().split(',');
  req.params.campaignGroupId = req.params.campaignGroupId.toLowerCase();
  const { campaignGroupId } = req.params;
  if (!knownCampaignGroups.includes(campaignGroupId)) {
    return next(CreateError.NotFound(`The campaign ${campaignGroupId} is not registered in this environment.`));
  }
  return next();
});

router.get('/:campaignGroupId/unsubscribe', asyncHandler(async (req: ReposAppRequest, res: any, next) => {
  const { campaignStateProvider } = req.app.settings.providers as IProviders;
  if (!campaignStateProvider) {
    return next(new Error('This app is not configured for campaign management'));
  }
  const { campaignGroupId } = req.params;
  if (!campaignGroupId) {
    return next(new Error('Campaign required to unsubscribe'));
  }
  const corporateId = req.individualContext.corporateIdentity.id;
  if (!corporateId) {
    return next (new Error('Corporate ID required'));
  }
  const currentState = await campaignStateProvider.getState(corporateId, campaignGroupId);
  if (currentState && currentState.optOut) {
    req.individualContext.webContext.saveUserAlert(`You've already opted out of the ${campaignGroupId} campaign.`, 'Opt-out', 'success');
  } else {
    await campaignStateProvider.optOut(corporateId, campaignGroupId);
    req.individualContext.webContext.saveUserAlert(`You've opted out of the ${campaignGroupId} campaign.`, 'Opt-out', 'success');
  }
  return res.redirect('/');
}));

export default router;
