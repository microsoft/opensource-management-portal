//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { NextFunction, Response } from 'express';
import { ReposAppRequest } from '../interfaces/index.js';
import { isWebhookIngestionEndpointEnabled } from '../lib/transitional.js';

export default function rawBodyParser(req: ReposAppRequest, res: Response, next: NextFunction) {
  if (!isWebhookIngestionEndpointEnabled(req)) {
    return next();
  }

  // Since we have a site-wide implementation of body parser, this allows
  // routines access to the raw body if it is needed for processing
  // and validating webhooks

  // This raw value is only stored when webhook processing is happening,
  // when `EXPOSE_WEBHOOK_INGESTION_ENDPOINT` === `1`
  (req as any)._raw = '';
  req.on('data', (chunk) => {
    (req as any)._raw += chunk;
  });
  return next();
}
