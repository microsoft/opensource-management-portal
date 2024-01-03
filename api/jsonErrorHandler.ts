//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { NextFunction, Response } from 'express';
import { getProviders } from '../lib/transitional';

export default function JsonErrorHandler(err, req, res: Response, next: NextFunction) {
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
  const providers = getProviders(req);
  if (providers && providers.insights) {
    providers.insights.trackException({ exception: err });
  }
}
