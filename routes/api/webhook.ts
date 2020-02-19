//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

import express = require('express');
import asyncHandler from 'express-async-handler';
import { jsonError } from '../../middleware/jsonError';

import moment from 'moment';
import { ReposAppRequest } from '../../transitional';
const router = express.Router();

import OrganizationWebhookProcessor from '../../webhooks/organizationProcessor';

interface IRequestWithRaw extends ReposAppRequest {
  _raw?: any;
}

router.use(asyncHandler(async (req: IRequestWithRaw, res, next) => {
  const body = req.body;
  const orgName = body && body.organization && body.organization.login ? body.organization.login : null;
  if (!orgName) {
    return next(jsonError(new Error('No organization login in the body'), 400));
  }
  const operations = req.app.settings.providers.operations;
  try {
    if (!req.organization) {
      req.organization = operations.getOrganization(orgName);
    }
  } catch (noOrganization) {
    return next(jsonError(new Error('This API endpoint is not configured for the provided organization name.')));
  }
  const properties = {
    delivery: req.headers['x-github-delivery'] as string,
    event: req.headers['x-github-event'] as string,
    signature: req.headers['x-hub-signature'] as string,
    started: moment().utc().format(),
  };
  if (!properties.delivery || !properties.signature || !properties.event) {
    return next(jsonError(new Error('Missing X-GitHub-Delivery, X-GitHub-Event, and/or X-Hub-Signature'), 400));
  }
  const event = {
    properties: properties,
    body: req.body,
    rawBody: req._raw,
  };
  const options = {
    operations,
    organization: req.organization,
    event,
  };
  let error = null;
  let result = null;
  try {
    result = await OrganizationWebhookProcessor(options);
  } catch (hookError) {
    error = hookError;
  }
  const obj = error || result;
  const statusCode = obj.statusCode || obj.status || (error ? 400 : 200);
  if (error) {
    return next(jsonError(error, statusCode));
  }
  res.status(statusCode);
  res.json(result);
}));

module.exports = router;
