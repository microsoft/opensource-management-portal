//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

import express = require('express');
import { jsonError } from '../../middleware/jsonError';

import moment = require('moment');
import { ReposAppRequest } from '../../transitional';
const router = express.Router();

const organizationWebhookProcessor = require('../../webhooks/organizationProcessor');

interface IRequestWithRaw extends ReposAppRequest {
  _raw?: any;
}

router.use((req: IRequestWithRaw, res, next) => {
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
    delivery: req.headers['x-github-delivery'],
    event: req.headers['x-github-event'],
    signature: req.headers['x-hub-signature'],
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
    operations: operations,
    organization: req.organization,
    event: event,
  };
  organizationWebhookProcessor(options, (error, result) => {
    const obj = error || result;
    const statusCode = obj.statusCode || obj.status || (error ? 400 : 200);
    if (error) {
      return next(jsonError(error, statusCode));
    }
    res.status(statusCode);
    res.json(result); // , statusCode);
  });
});

module.exports = router;
