//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import express from 'express';
import asyncHandler from 'express-async-handler';
const router = express.Router();

import { ReposAppRequest, IProviders } from '../../transitional';
import { getReviewService } from './reviewService';
import { jsonError } from '../../middleware/jsonError';

const releaseApprovalsRedisKey = 'release-approvals';

router.get('/', asyncHandler(async (req: ReposAppRequest, res, next) => {
  const { cacheProvider } = req.app.settings.providers as IProviders;
  try {
    const reviewService = getReviewService(req.app.settings.runtimeConfig);
    const data = await cacheProvider.getObject(releaseApprovalsRedisKey);
    if (data) {
      return res.json({ releaseApprovals: data });
    }
    const reviews = await reviewService.getAllReleaseReviews();
    await cacheProvider.setObjectWithExpire(releaseApprovalsRedisKey, reviews, 60 * 24);
    res.json({ releaseApprovals: reviews });
  } catch (error) {
    return next(jsonError(error, 400));
  }
}));

router.post('/', asyncHandler(async (req: ReposAppRequest, res, next) => {
  const { graphProvider, cacheProvider, insights } = req.app.settings.providers as IProviders;
  try {
    const context = req.individualContext || req.apiContext;
    const id = context.corporateIdentity.id;
    const body = req.body;
    if (!body) {
      return next(jsonError('No body', 400));
    }
    let alias = null;
    try {
      const graph = await graphProvider.getUserById(id);
      if (graph && graph.mailNickname) {
        alias = graph.mailNickname;
      }
      if (!alias) {
        throw new Error(`Given the user ID of ${id}, we were unable to find the alias of address for the user`);
      }
    } catch (getAliasError) {
      return next(jsonError(new Error(getAliasError.message)));
    }
    const reviewService = getReviewService(req.app.settings.runtimeConfig);
    const response = await reviewService.submitReleaseRequestBatch({
      context: {
        user: alias,
      },
      requests: body,
    });
    insights.trackEvent({
      name: 'ApiClientCreateReleaseApproval',
      properties: {
        requestBody: JSON.stringify(body),
        responseBody: JSON.stringify(response),
      },
    });
    const result = response[0];
    if (result.issue || result.error) {
      if (result.error && typeof(result.error) === 'string') {
        const knownError = result.error as string;
        // Fallback reviewers can have a better error message
        if (knownError.includes('Ipsum Business Reviewers')) {
          return next(jsonError(`There is no known business reviewer for your organization. Please report this issue to OpenSourceEngSupport@microsoft.com to help configure a business reviewer and unblock your request. ${knownError}`))
        }
      }
      try {
        // Never-used business reviewer case
        const consolidatedError = result.issue || result.error;
        const consolidated = JSON.stringify(consolidatedError.toString());
        if (consolidated && consolidated.includes('is an unknown identity')) {
          return next(jsonError(`The business reviewer for your organization has not used the OSSMSFT Azure DevOps organization before, so the business review cannot be assigned to them. Please report this issue to OpenSourceEngSupport@microsoft.com to help configure the business reviewer in the instance and unblock your request. ${consolidated}`));
        }
      } catch (ignore) { /* ignore */ }
      return next(jsonError(result.issue || result.error || 'Failed to create new release registration'));
    }
    const reviews = await reviewService.getAllReleaseReviews();
    await cacheProvider.setObjectWithExpire(releaseApprovalsRedisKey, reviews, 60 * 24);
    // BUG in the implementation: seemed to be sending multiple results! return res.json({ releaseApprovals: reviews });
    return res.json({
      releaseApprovals: [result.review]
    });
  } catch (error) {
    return next(jsonError(error));
  }
}));

export default router;
