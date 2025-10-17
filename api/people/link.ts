//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { NextFunction, Response } from 'express';

import { CreateError, getProviders } from '../../lib/transitional.js';
import { jsonError } from '../../middleware/index.js';
import { ICorporateLink, LinkOperationSource, ReposApiRequest } from '../../interfaces/index.js';

const linkScope = 'link';

// prettier-ignore
const supportedApiVersions = new Set([
  '2019-10-01',
]);

export default async function postLinkApi(req: ReposApiRequest, res: Response, next: NextFunction) {
  const providers = getProviders(req);
  const { operations } = providers;
  const token = req.apiKeyToken;
  const apiVersion = (req.query['api-version'] || req.headers['api-version']) as string;
  if (!apiVersion || !supportedApiVersions.has(apiVersion)) {
    return next(CreateError.InvalidParameters('Unsupported API version'));
  }
  if (providers.config.api.flags.createLinks !== true) {
    return next(CreateError.InvalidParameters('This application is not configured to allow this API'));
  }
  if (!token.hasScope(linkScope)) {
    return next(CreateError.NotAuthorized('The key is not authorized to use the link API'));
  }
  // CONSIDER: Azure REST API would accept a request header client-request-id and also if True for return-client-request-id, send it back in the response
  const correlationId = req.correlationId;
  const body = req.body;
  if (!body.corporate) {
    return next(jsonError('corporate object required', 400));
  }
  const corporateId = body.corporate.id;
  if (!corporateId) {
    return next(jsonError('corporate.id required', 400));
  }
  if (!body.github) {
    return next(jsonError('github object required', 400));
  }
  const serviceAccountMail = body.corporate.serviceAccountMail;
  const thirdPartyId = body.github.id;
  if (!thirdPartyId) {
    return next(jsonError('github.id required', 400));
  }
  // validate that the corporate ID nor the GitHub ID are already linked
  const link: ICorporateLink = {
    thirdPartyAvatar: null,
    thirdPartyId: thirdPartyId,
    thirdPartyUsername: null,
    corporateId: corporateId,
    corporateUsername: null,
    corporateDisplayName: null,
    corporateMailAddress: null,
    corporateAlias: null,
    isServiceAccount: false,
    serviceAccountMail,
  };
  try {
    const newLinkOutcome = await operations.linkAccounts({
      link,
      operationSource: LinkOperationSource.Api,
      correlationId,
    });
    res.status(201);
    if (newLinkOutcome.resourceLink) {
      res.header('location', newLinkOutcome.resourceLink);
    }
    return res.end();
  } catch (linkError) {
    return next(jsonError(linkError));
  }
}
