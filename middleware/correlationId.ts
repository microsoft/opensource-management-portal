//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'crypto';

export type WithCorrelationId<T> = T & {
  correlationId?: string;
};

// Generate a correlation ID
export default function (req: WithCorrelationId<Request>, res: Response, next: NextFunction) {
  req.correlationId = randomUUID();
  return next();
}
