//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { NextFunction, Response } from 'express';

import { getProviders } from '../lib/transitional.js';
import { ReposAppRequest } from '../interfaces/web.js';

const errorMessages = [
  'Session is not authenticated',
  'Sorry, this endpoint and extension were permanently deprecated in March 2024.',
];

export default function jsonErrorHandler(
  err: Error,
  req: ReposAppRequest,
  res: Response,
  next: NextFunction
) {
  if (err && err['json']) {
    // jsonError objects should bubble up like before
    return next(err);
  }
  // If any errors happened in the API routes that did not send a jsonError,
  // just return as a JSON error and end here.
  if (err && err['status']) {
    res.status(err['status']);
  } else {
    res.status(500);
  }
  res.json({
    message: err && err.message ? err.message : 'Error',
  });
  if (err?.message && errorMessages.includes(err.message)) {
    // no need to track these errors to reduce noise
  } else {
    const providers = getProviders(req);
    const properties = (err as any)?.insightsProperties || {};
    providers?.insights?.trackException({ exception: err, properties });
  }
}
