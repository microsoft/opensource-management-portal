//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { NextFunction, Response } from 'express';
import { randomUUID } from 'crypto';

// Generate a correlation ID
export default function (req, res: Response, next: NextFunction) {
  req.correlationId = randomUUID();
  return next();
}
